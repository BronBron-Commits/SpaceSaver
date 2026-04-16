const loginPanel = document.getElementById('loginPanel');
const drivePanel = document.getElementById('drivePanel');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const tableBody = document.getElementById('fileTableBody');
const currentPathText = document.getElementById('currentPath');
const message = document.getElementById('message');
const upBtn = document.getElementById('upBtn');
const newFolderBtn = document.getElementById('newFolderBtn');
const fileInput = document.getElementById('fileInput');
const logoutBtn = document.getElementById('logoutBtn');
const rowTemplate = document.getElementById('rowTemplate');
const previewModal = document.getElementById('previewModal');
const previewBackdrop = document.getElementById('previewBackdrop');
const previewTitle = document.getElementById('previewTitle');
const previewMeta = document.getElementById('previewMeta');
const previewBody = document.getElementById('previewBody');
const closePreviewBtn = document.getElementById('closePreviewBtn');
const previewOpenLink = document.getElementById('previewOpenLink');
const previewDownloadLink = document.getElementById('previewDownloadLink');

let currentPath = '';
let parentPath = null;
let uploadInProgress = false;
const API_BASE = window.location.pathname.startsWith('/files') ? '/files' : '';

function apiUrl(pathValue) {
  return `${API_BASE}${pathValue}`;
}

const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']);
const videoExtensions = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v']);
const audioExtensions = new Set(['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac']);
const textExtensions = new Set(['txt', 'md', 'json', 'js', 'ts', 'css', 'html', 'xml', 'yml', 'yaml', 'log', 'csv']);
const pdfExtensions = new Set(['pdf']);
const modelExtensions = new Set(['glb', 'gltf', 'usdz']);

function getExtension(fileName = '') {
  const index = fileName.lastIndexOf('.');
  if (index < 0 || index === fileName.length - 1) {
    return '';
  }
  return fileName.slice(index + 1).toLowerCase();
}

function getPreviewUrl(pathValue) {
  return apiUrl(`/api/preview?path=${encodeURIComponent(pathValue)}`);
}

function closePreview() {
  previewModal.classList.add('hidden');
  previewModal.setAttribute('aria-hidden', 'true');
  previewBody.innerHTML = '';
}

function createPreviewElement(tagName, attributes = {}) {
  const element = document.createElement(tagName);
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, value);
  });
  return element;
}

async function renderTextPreview(pathValue) {
  const response = await fetch(getPreviewUrl(pathValue));
  if (!response.ok) {
    throw new Error('Unable to load file preview');
  }

  const text = await response.text();
  const pre = document.createElement('pre');
  pre.className = 'text-preview';
  pre.textContent = text.slice(0, 200000);
  return pre;
}

async function buildPreviewContent(entry) {
  const ext = getExtension(entry.name);
  const previewUrl = getPreviewUrl(entry.path);

  if (imageExtensions.has(ext)) {
    const img = createPreviewElement('img', { src: previewUrl, alt: entry.name, class: 'image-preview' });
    return img;
  }

  if (videoExtensions.has(ext)) {
    const video = createPreviewElement('video', {
      src: previewUrl,
      controls: 'controls',
      class: 'video-preview'
    });
    return video;
  }

  if (audioExtensions.has(ext)) {
    const audio = createPreviewElement('audio', {
      src: previewUrl,
      controls: 'controls',
      class: 'audio-preview'
    });
    return audio;
  }

  if (pdfExtensions.has(ext)) {
    const frame = createPreviewElement('iframe', {
      src: previewUrl,
      class: 'doc-preview',
      title: `${entry.name} preview`
    });
    return frame;
  }

  if (modelExtensions.has(ext)) {
    const model = createPreviewElement('model-viewer', {
      src: previewUrl,
      'camera-controls': 'true',
      'auto-rotate': 'true',
      class: 'model-preview'
    });
    return model;
  }

  if (textExtensions.has(ext)) {
    return renderTextPreview(entry.path);
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'fallback-preview';
  const note = document.createElement('p');
  note.textContent = 'No specialized preview is available for this file type. Use Open in new tab or Download.';
  wrapper.appendChild(note);
  return wrapper;
}

async function openPreview(entry) {
  previewModal.classList.remove('hidden');
  previewModal.setAttribute('aria-hidden', 'false');

  previewTitle.textContent = entry.name;
  previewMeta.textContent = `${entry.type} • ${formatBytes(entry.size)} • ${new Date(entry.modifiedAt).toLocaleString()}`;

  const previewUrl = getPreviewUrl(entry.path);
  previewOpenLink.href = previewUrl;
  previewDownloadLink.href = apiUrl(`/api/download?path=${encodeURIComponent(entry.path)}`);

  previewBody.innerHTML = '';
  const loading = document.createElement('p');
  loading.className = 'muted';
  loading.textContent = 'Loading preview...';
  previewBody.appendChild(loading);

  try {
    const content = await buildPreviewContent(entry);
    previewBody.innerHTML = '';
    previewBody.appendChild(content);
  } catch (error) {
    previewBody.innerHTML = '';
    const messageText = document.createElement('p');
    messageText.className = 'error';
    messageText.textContent = error.message || 'Unable to preview this file';
    previewBody.appendChild(messageText);
  }
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) {
    return '-';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(bytes);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function setMessage(text, isError = false) {
  message.textContent = text || '';
  message.style.color = isError ? 'var(--danger)' : 'var(--accent)';
}

async function apiFetch(url, options = {}) {
  const response = await fetch(apiUrl(url), {
    headers: {
      ...(options.headers || {})
    },
    ...options
  });

  const isJson = (response.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    const errorMessage = payload && payload.error ? payload.error : 'Request failed';
    throw new Error(errorMessage);
  }

  return payload;
}

function clearTable() {
  tableBody.innerHTML = '';
}

function navigateTo(pathValue) {
  loadDirectory(pathValue).catch((error) => {
    setMessage(error.message, true);
  });
}

function renderRows(entries) {
  clearTable();

  for (const entry of entries) {
    const row = rowTemplate.content.firstElementChild.cloneNode(true);
    const nameCell = row.querySelector('.name-cell');
    const typeCell = row.querySelector('.type-cell');
    const sizeCell = row.querySelector('.size-cell');
    const dateCell = row.querySelector('.date-cell');
    const actionCell = row.querySelector('.action-cell');

    if (entry.type === 'folder') {
      row.classList.add('folder-row');
      row.addEventListener('click', (event) => {
        if (event.target.closest('.action-cell')) {
          return;
        }
        navigateTo(entry.path);
      });

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.textContent = entry.name;
      openBtn.className = 'folder-link';
      openBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        navigateTo(entry.path);
      });
      nameCell.appendChild(openBtn);
    } else {
      const previewBtn = document.createElement('button');
      previewBtn.type = 'button';
      previewBtn.className = 'file-link';
      previewBtn.textContent = entry.name;
      previewBtn.addEventListener('click', () => {
        openPreview(entry);
      });
      nameCell.appendChild(previewBtn);
    }

    typeCell.textContent = entry.type;
    sizeCell.textContent = formatBytes(entry.size);
    dateCell.textContent = new Date(entry.modifiedAt).toLocaleString();

    if (entry.type === 'file') {
      const downloadLink = document.createElement('a');
      downloadLink.className = 'btn';
      downloadLink.textContent = 'Download';
      downloadLink.href = apiUrl(`/api/download?path=${encodeURIComponent(entry.path)}`);
      actionCell.appendChild(downloadLink);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteEntry(entry.path, entry.name));
    actionCell.appendChild(deleteBtn);

    tableBody.appendChild(row);
  }
}

async function loadDirectory(pathValue = '') {
  const data = await apiFetch(`/api/list?path=${encodeURIComponent(pathValue)}`);
  currentPath = data.currentPath || '';
  parentPath = data.parentPath;
  currentPathText.textContent = `/${currentPath}`.replace(/\/$/, '/');
  upBtn.disabled = parentPath === null;
  renderRows(data.entries || []);
}

async function loadFiles() {
  await loadDirectory('');
}

async function deleteEntry(pathValue, name) {
  const shouldDelete = window.confirm(`Delete ${name}? This cannot be undone.`);
  if (!shouldDelete) {
    return;
  }

  try {
    await apiFetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: pathValue })
    });
    setMessage(`Deleted ${name}`);
    await loadDirectory(currentPath);
  } catch (error) {
    setMessage(error.message, true);
  }
}

async function uploadFiles() {
  if (uploadInProgress) {
    setMessage('An upload is already in progress.');
    return;
  }

  if (!fileInput.files || fileInput.files.length === 0) {
    return;
  }

  const selectedFiles = Array.from(fileInput.files);
  const formData = new FormData();
  formData.append('path', currentPath);
  for (const file of selectedFiles) {
    formData.append('files', file);
  }

  uploadInProgress = true;
  fileInput.disabled = true;
  setMessage(`Uploading ${selectedFiles.length} file(s)...`);

  try {
    const result = await apiFetch('/api/upload', {
      method: 'POST',
      body: formData
    });

    setMessage(`Uploaded ${result.uploaded} file(s)`);
    await loadDirectory(currentPath);
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    // Always clear the input so selecting the same file triggers "change" again.
    fileInput.value = '';
    fileInput.disabled = false;
    uploadInProgress = false;
  }
}

async function createFolder() {
  const name = window.prompt('Folder name');
  if (!name) {
    return;
  }

  try {
    await apiFetch('/api/folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentPath, name })
    });
    setMessage(`Created folder ${name}`);
    await loadDirectory(currentPath);
  } catch (error) {
    setMessage(error.message, true);
  }
}

async function doLogout() {
  try {
    await apiFetch('/api/logout', { method: 'POST' });
  } catch (error) {
    console.error(error);
  }
  drivePanel.classList.add('hidden');
  loginPanel.classList.remove('hidden');
}

async function login(username, password) {
  await apiFetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });

  loginPanel.classList.add('hidden');
  drivePanel.classList.remove('hidden');
  await loadFiles();
}

async function bootstrap() {
  try {
    const auth = await apiFetch('/api/me');
    if (auth.authenticated) {
      loginPanel.classList.add('hidden');
      drivePanel.classList.remove('hidden');
      await loadFiles();
    }
  } catch (error) {
    console.error(error);
  }
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';

  const formData = new FormData(loginForm);
  const username = String(formData.get('username') || '').trim();
  const password = String(formData.get('password') || '');

  try {
    await login(username, password);
    loginForm.reset();
    setMessage('Welcome back.');
  } catch (error) {
    loginError.textContent = error.message;
  }
});

upBtn.addEventListener('click', () => {
  if (parentPath !== null) {
    navigateTo(parentPath);
  }
});

newFolderBtn.addEventListener('click', createFolder);
fileInput.addEventListener('change', uploadFiles);
logoutBtn.addEventListener('click', doLogout);
closePreviewBtn.addEventListener('click', closePreview);
previewBackdrop.addEventListener('click', closePreview);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !previewModal.classList.contains('hidden')) {
    closePreview();
  }
});

bootstrap();
