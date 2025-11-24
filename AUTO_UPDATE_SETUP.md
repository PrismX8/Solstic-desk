# Auto-Update Setup Guide

## What You Need to Provide

To enable auto-updates, I need the following information from you:

### 1. GitHub Repository Information
- **GitHub Username/Organization**: Your GitHub username (e.g., `your-username`)
- **Repository Name**: The name of your repository (e.g., `anydesk-clone`)

### 2. GitHub Personal Access Token
You need to create a GitHub Personal Access Token with the following permissions:
- For **private repositories**: `repo` scope
- For **public repositories**: `public_repo` scope

**How to create a token:**
1. Go to https://github.com/settings/tokens
2. Click "Generate new token" → "Generate new token (classic)"
3. Give it a name like "Solstice Desk Auto-Updates"
4. Select the appropriate scope (`repo` for private, `public_repo` for public)
5. Click "Generate token"
6. **Copy the token immediately** (you won't see it again!)

### 3. Update Configuration Files

Once you have the information above, I'll need you to:

1. **Update `desktop/electron-builder.json`**:
   - Replace `YOUR_GITHUB_USERNAME` with your GitHub username
   - Replace `YOUR_REPO_NAME` with your repository name

2. **Set environment variable for publishing**:
   ```bash
   # Windows PowerShell
   $env:GITHUB_TOKEN="your_token_here"
   
   # Or create a .env file in the desktop folder with:
   GITHUB_TOKEN=your_token_here
   ```

## How It Works

1. **Building with auto-updates**: When you run `npm run dist:desktop`, electron-builder will:
   - Build the installer
   - Create a GitHub Release
   - Upload the installer and update files to the release
   - Tag the release with the version number

2. **Client-side**: The app will:
   - Check for updates on startup (after 3 seconds)
   - Check every 4 hours automatically
   - Download updates in the background
   - Prompt user to install when ready
   - Auto-install on app quit (or user can trigger manually)

## Publishing a New Version

1. **Update version** in `desktop/package.json`:
   ```json
   "version": "0.1.2"
   ```

2. **Build and publish**:
   ```bash
   cd desktop
   npm run dist
   ```
   
   This will:
   - Build the app
   - Create a GitHub release
   - Upload the installer
   - Users will get notified of the update automatically

## Testing Auto-Updates

1. Build version 0.1.1 and install it
2. Update version to 0.1.2 in package.json
3. Build and publish 0.1.2
4. Launch the 0.1.1 app - it should detect and download 0.1.2

## Important Notes

- **Version numbers**: Always increment the version in `package.json` before building
- **GitHub Releases**: Each build creates a new GitHub release
- **Token security**: Never commit your GitHub token to the repository
- **First build**: The first time you publish, users need to install manually. After that, updates are automatic.

## Troubleshooting

- **"Update not found"**: Make sure the version in package.json is higher than the installed version
- **"Authentication failed"**: Check your GitHub token has the correct permissions
- **"Release not found"**: Ensure the repository name and owner are correct in electron-builder.json

