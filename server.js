require('dotenv').config({ override: true });

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const multer = require('multer');
const fs = require('fs/promises');
const path = require('path');

const app = express();
const port = Number(process.env.PORT || 8080);
const driveRoot = path.resolve(process.env.DRIVE_ROOT || path.join(__dirname, 'drive'));
const isProduction = process.env.NODE_ENV === 'production';

function normalizeCredential(value) {
  return String(value || '').trim();
}

function parseUsersFromEnv(rawUsers) {
  const raw = String(rawUsers || '').trim();
  if (!raw) {
    return {
      users: [],
      hadParseError: false
    };
  }

  const attempts = [
    raw,
    raw.replace(/^['"](.*)['"]$/s, '$1')
  ];

  let hadParseError = false;

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (!Array.isArray(parsed)) {
        continue;
      }

      return {
        users: parsed
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
          username: normalizeCredential(entry.username),
          password: normalizeCredential(entry.password)
        }))
        .filter((entry) => entry.username && entry.password),
        hadParseError
      };
    } catch {
      hadParseError = true;
    }
  }

  return {
    users: [],
    hadParseError
  };
}

const parsedUsers = parseUsersFromEnv(process.env.USERS);
const users = parsedUsers.users;

const adminCredentials = {
  username: normalizeCredential(process.env.ADMIN_USER),
  password: normalizeCredential(process.env.ADMIN_PASS)
};

if (adminCredentials.username && adminCredentials.password) {
  const alreadyPresent = users.some(
    (entry) => entry.username === adminCredentials.username && entry.password === adminCredentials.password
  );
  if (!alreadyPresent) {
    users.push(adminCredentials);
  }
}

if (!users.length) {
  // Keep a predictable, documented local-dev fallback when nothing is configured.
  users.push({ username: 'admin', password: 'ChangeMeNow!' });
  console.warn('No USERS/ADMIN credentials configured; using default admin fallback.');
}

if (parsedUsers.hadParseError) {
  console.warn('USERS in environment could not be parsed as JSON; check quoting and escaping.');
}

console.log(`Auth users loaded: ${users.map((entry) => entry.username).join(', ')}`);

if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET is not set. Using a temporary insecure value.');
}

const sessionSecret = process.env.SESSION_SECRET || 'temporary-insecure-secret';

async function ensureDriveRoot() {
  await fs.mkdir(driveRoot, { recursive: true });
}

function normalizeRelativePath(input = '') {
  const raw = String(input).replace(/\\/g, '/');
  const normalized = path.posix.normalize(raw);
  const trimmed = normalized.replace(/^\/+/, '').replace(/^\.\//, '');

  if (trimmed === '..' || trimmed.startsWith('../')) {
    throw new Error('Invalid path');
  }

  return trimmed === '.' ? '' : trimmed;
}

function resolveInsideDrive(relativePath = '') {
  const safeRelative = normalizeRelativePath(relativePath);
  const absolute = path.resolve(driveRoot, safeRelative);
  const relativeToRoot = path.relative(driveRoot, absolute);

  if (relativeToRoot && (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot))) {
    throw new Error('Path escapes drive root');
  }

  return { absolute, safeRelative };
}

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}

function toPublicEntry(baseRelative, dirent, stats) {
  const relPath = [baseRelative, dirent.name].filter(Boolean).join('/');
  return {
    name: dirent.name,
    path: relPath,
    type: dirent.isDirectory() ? 'folder' : 'file',
    size: dirent.isDirectory() ? null : stats.size,
    modifiedAt: stats.mtime.toISOString()
  };
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        scriptSrc: ["'self'", 'https://unpkg.com', 'https://static.cloudflareinsights.com', "'unsafe-eval'"],
        connectSrc: ["'self'", 'https://unpkg.com', 'https://cloudflareinsights.com']
      }
    }
  })
);

if (isProduction) {
  app.set('trust proxy', 1);
}

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: sessionSecret,
    proxy: isProduction,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction ? 'auto' : false,
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_BYTES || 1024 * 1024 * 200)
  }
});

app.post('/api/login', (req, res, next) => {
  const username = normalizeCredential(req.body && req.body.username);
  const password = normalizeCredential(req.body && req.body.password);

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const match = users.find(u => u.username === username && u.password === password);

  if (match) {
    req.session.authenticated = true;
    req.session.username = match.username;
    return req.session.save((error) => {
      if (error) {
        return next(error);
      }
      return res.json({ ok: true, username: match.username });
    });
  }
  return res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/api/logout', requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.json({ authenticated: true, username: req.session.username });
  }
  return res.json({ authenticated: false });
});

app.get('/api/list', requireAuth, async (req, res, next) => {
  try {
    const { absolute, safeRelative } = resolveInsideDrive(req.query.path || '');
    const entries = await fs.readdir(absolute, { withFileTypes: true });

    const mapped = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(absolute, entry.name);
        const stats = await fs.stat(entryPath);
        return toPublicEntry(safeRelative, entry, stats);
      })
    );

    mapped.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

    const parent = safeRelative.includes('/')
      ? safeRelative.slice(0, safeRelative.lastIndexOf('/'))
      : safeRelative
      ? ''
      : null;

    return res.json({
      currentPath: safeRelative,
      parentPath: parent,
      entries: mapped
    });
  } catch (error) {
    return next(error);
  }
});

app.post('/api/folder', requireAuth, async (req, res, next) => {
  try {
    const base = req.body.path || '';
    const name = String(req.body.name || '').trim();

    if (!name || /[\\/:*?"<>|]/.test(name)) {
      return res.status(400).json({ error: 'Invalid folder name' });
    }

    const { safeRelative } = resolveInsideDrive(base);
    const targetRelative = [safeRelative, name].filter(Boolean).join('/');
    const { absolute } = resolveInsideDrive(targetRelative);
    await fs.mkdir(absolute, { recursive: false });
    return res.json({ ok: true });
  } catch (error) {
    if (error.code === 'EEXIST') {
      return res.status(409).json({ error: 'Folder already exists' });
    }
    return next(error);
  }
});

app.post('/api/upload', requireAuth, upload.array('files', 30), async (req, res, next) => {
  try {
    const base = req.body.path || '';
    const { absolute } = resolveInsideDrive(base);

    const files = req.files || [];
    await Promise.all(
      files.map(async (file) => {
        const destination = path.join(absolute, file.originalname);
        await fs.writeFile(destination, file.buffer, { flag: 'wx' });
      })
    );

    return res.json({ ok: true, uploaded: files.length });
  } catch (error) {
    if (error.code === 'EEXIST') {
      return res.status(409).json({ error: 'A file with the same name already exists' });
    }
    return next(error);
  }
});

app.get('/api/download', requireAuth, async (req, res, next) => {
  try {
    const rel = req.query.path || '';
    const { absolute } = resolveInsideDrive(rel);
    const stats = await fs.stat(absolute);

    if (!stats.isFile()) {
      return res.status(400).json({ error: 'Path is not a file' });
    }

    return res.download(absolute);
  } catch (error) {
    return next(error);
  }
});

app.get('/api/preview', requireAuth, async (req, res, next) => {
  try {
    const rel = req.query.path || '';
    const { absolute } = resolveInsideDrive(rel);
    const stats = await fs.stat(absolute);

    if (!stats.isFile()) {
      return res.status(400).json({ error: 'Path is not a file' });
    }

    res.setHeader('Content-Disposition', 'inline');
    return res.sendFile(absolute);
  } catch (error) {
    return next(error);
  }
});

app.post('/api/delete', requireAuth, async (req, res, next) => {
  try {
    const rel = req.body.path || '';
    const { absolute } = resolveInsideDrive(rel);
    const stats = await fs.stat(absolute);

    if (stats.isDirectory()) {
      await fs.rm(absolute, { recursive: true, force: false });
    } else {
      await fs.unlink(absolute);
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/{*splat}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((error, req, res, _next) => {
  if (error.code === 'ENOENT') {
    return res.status(404).json({ error: 'Not found' });
  }

  if (error.message === 'Invalid path' || error.message === 'Path escapes drive root') {
    return res.status(400).json({ error: 'Invalid path' });
  }

  if (error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large' });
  }

  console.error('Unexpected error:', error);

  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Server error' });
  }

  return res.status(500).send('Server error');
});

ensureDriveRoot()
  .then(() => {
    app.listen(port, () => {
      console.log(`SpaceSaver running at http://localhost:${port}`);
      console.log(`Drive root: ${driveRoot}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize drive root:', error);
    process.exit(1);
  });
