import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';

const router = Router();

// Minimum required version - update this when you need to force updates
const MINIMUM_VERSION = process.env.MINIMUM_APP_VERSION || '0.1.0';
// Current latest version - update this when you release a new version
const CURRENT_VERSION = process.env.CURRENT_APP_VERSION || '0.1.0';
// Base URL for updates (your Railway server URL)
const UPDATE_BASE_URL = process.env.UPDATE_BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN 
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : 'https://railways.up.railway.app';

router.get('/version', (_req, res) => {
  res.json({
    minimumVersion: MINIMUM_VERSION,
    currentVersion: CURRENT_VERSION,
    updateUrl: `${UPDATE_BASE_URL}/api/updates`,
  });
});

// Serve update manifest (latest.yml) for electron-updater
router.get('/updates/latest.yml', (_req, res) => {
  const manifestPath = path.join(process.cwd(), 'updates', 'latest.yml');
  
  if (fs.existsSync(manifestPath)) {
    res.setHeader('Content-Type', 'application/x-yaml');
    res.sendFile(manifestPath);
  } else {
    res.status(404).json({ error: 'Update manifest not found' });
  }
});

// Serve update installer
router.get('/updates/:filename', (req, res) => {
  const filename = req.params.filename;
  // Only allow .exe files for security
  if (!filename.endsWith('.exe') && !filename.endsWith('.blockmap')) {
    return res.status(400).json({ error: 'Invalid file type' });
  }
  
  const filePath = path.join(process.cwd(), 'updates', filename);
  
  if (fs.existsSync(filePath)) {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: 'Update file not found' });
  }
});

export default router;

