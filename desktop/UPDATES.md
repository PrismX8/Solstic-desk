# Auto-Update System (Custom Server)

## How It Works

1. **Version Check on Startup**: App checks server for minimum required version
2. **Force Update**: If app version is below minimum, app blocks usage and shows update dialog
3. **Optional Updates**: If newer version available, shows notification
4. **Auto-Install**: Downloads and installs updates automatically from your Railway server

## Setup

### 1. Create Updates Directory on Server

On your Railway server, create an `updates/` directory in the server root:
```bash
mkdir updates
```

### 2. Configure Version on Server

Set environment variables on Railway:
```bash
MINIMUM_APP_VERSION=0.1.0
CURRENT_APP_VERSION=0.2.0
UPDATE_BASE_URL=https://your-railway-domain.up.railway.app
```

Or edit `server/src/routes/version.ts` directly.

### 3. Build Update Files

When you release a new version:

```bash
# Update version in desktop/package.json
# Then build:
npm run dist:desktop
```

This creates:
- `desktop/release/Solstice Desk Setup 0.2.0.exe` - Installer
- `desktop/release/latest.yml` - Update manifest

### 4. Upload Update Files to Server

**Option A: Using Railway's File System (if persistent storage)**

1. SSH into your Railway service or use Railway CLI
2. Upload files to `updates/` directory:
```bash
# Copy files to server
scp desktop/release/latest.yml railway:/app/updates/
scp "desktop/release/Solstice Desk Setup 0.2.0.exe" railway:/app/updates/
```

**Option B: Using Railway Volumes (Recommended)**

1. Add a Railway Volume to your service
2. Mount it at `/app/updates`
3. Upload files to the volume

**Option C: Using External Storage (S3, etc.)**

Modify `server/src/routes/version.ts` to fetch files from S3 or another storage service.

### 5. Update Server Version

Update the environment variable on Railway:
```bash
CURRENT_APP_VERSION=0.2.0
```

Or if forcing updates:
```bash
MINIMUM_APP_VERSION=0.2.0
CURRENT_APP_VERSION=0.2.0
```

## File Structure on Server

```
server/
├── updates/
│   ├── latest.yml                    # Update manifest (required)
│   ├── Solstice Desk Setup 0.2.0.exe # Installer (required)
│   └── Solstice Desk Setup 0.2.0.exe.blockmap # Optional
```

## Update Flow

1. **App starts** → Checks `/api/version` for minimum version
2. **If too old** → Shows "Update Required" dialog → Quits
3. **If update available** → Checks `/api/updates/latest.yml`
4. **Downloads** → `/api/updates/Solstice Desk Setup X.X.X.exe`
5. **Installs** → Restarts app with new version

## Testing

1. Install version 0.1.0
2. Set `MINIMUM_VERSION = '0.2.0'` on server
3. Restart app → Should show "Update Required"
4. Upload 0.2.0 files to `updates/` directory
5. Set `MINIMUM_VERSION = '0.1.0'` and `CURRENT_VERSION = '0.2.0'`
6. Restart app → Should show "Update Available"
7. Click "Download Now" → Should download and install

## Railway Deployment

### Using Railway CLI

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Link project
railway link

# Upload update files
railway run --service server mkdir -p updates
railway run --service server "cd updates && curl -O https://your-cdn.com/latest.yml"
```

### Using Railway Dashboard

1. Go to your Railway project
2. Add a Volume to your server service
3. Mount it at `/app/updates`
4. Upload files through Railway's file browser or via SSH

## Environment Variables

- `MINIMUM_APP_VERSION`: Minimum required version (forces update)
- `CURRENT_APP_VERSION`: Latest available version
- `UPDATE_BASE_URL`: Base URL for updates (defaults to Railway domain)
- `UPDATE_SERVER`: Server URL for version checks (in desktop app)

## Troubleshooting

**Update not found (404)**
- Check that `latest.yml` exists in `updates/` directory
- Verify file permissions are readable
- Check Railway volume is mounted correctly

**Version check fails**
- Verify `/api/version` endpoint is accessible
- Check environment variables are set correctly
- Look at server logs for errors

**Download fails**
- Check installer file exists and is accessible
- Verify CORS settings allow downloads
- Check file size limits (Railway may have limits)

## Alternative: Use External CDN

If Railway storage is limited, you can host files on:
- AWS S3
- Cloudflare R2
- Any static file host

Then modify `server/src/routes/version.ts` to redirect to CDN URLs.
