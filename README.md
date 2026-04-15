# SpaceSaver Cloud Drive

A beautiful web app to access your network cloud drive from anywhere.

## Features

- Login-protected access
- Browse folders and files
- Upload files
- Download files
- Create folders
- Delete files and folders

## Quick Start

1. Install dependencies:
   npm install
2. Copy environment file:
   copy .env.example .env
3. Edit `.env` and set strong values for `ADMIN_PASS` and `SESSION_SECRET`.
4. Start the app:
   npm start
5. Open in your browser:
   http://localhost:8080

## Map To Your Windows Drive (Y:)

To make the web app browse and store files in your mounted drive, set this in `.env`:

DRIVE_ROOT=Y:\\

Notes:
- Keep the trailing backslash on Windows drive roots (`Y:\\`).
- If the app runs as a Windows service, mapped drive letters may not be visible to that service account. In that case, use a UNC path instead, such as `\\server\\share`.
- Verify the account running Node has read/write permissions to the target path.

## Important Security Notes

- This app is intended for trusted personal use.
- Use HTTPS when exposing it to the internet (reverse proxy with TLS).
- Choose a long random password and session secret.
- Prefer VPN access (for example Tailscale or WireGuard) over direct port forwarding.

## Deploying for Remote Access

1. Run the app on a machine that can reach your drive path.
2. Put a reverse proxy (Nginx/Caddy/Traefik) in front with HTTPS.
3. Set firewall rules so only required ports are reachable.
4. Optionally restrict by IP range or VPN users.

## Project Structure

- `server.js`: Express backend + file APIs
- `public/index.html`: main UI
- `public/styles.css`: styling and animations
- `public/app.js`: frontend app logic
