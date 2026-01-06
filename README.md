# Google Sheets Data Protection Extension

A Chrome Extension (Manifest V3) that prevents copying, cutting, selecting, and right-clicking data from Google Sheets. This extension serves as a security friction layer for internal organizational use.

## Features

- **Copy/Cut/Paste Blocking**: Prevents keyboard shortcuts (Ctrl+C, Ctrl+X, Ctrl+V, Ctrl+A) and clipboard operations
- **Right-Click Protection**: Blocks context menu access
- **Text Selection Blocking**: Prevents drag selection and text highlighting
- **Admin Console**: Password-protected admin interface for managing access requests
- **Request System**: Users can request temporary copy/paste access with predefined or custom durations
- **Session Management**: Time-bound access sessions with automatic expiration
- **Device Tracking**: Monitors all devices where extension is installed
- **Removal Detection**: Detects when extension is removed from devices and notifies admins
- **Audit Logging**: Comprehensive logging of all copy/paste attempts (blocked and allowed)
- **Badge Notifications**: Extension icon badge shows pending requests and removed devices count

## Installation

### For End Users

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the extension folder
6. The extension is now installed

### For Enterprise Deployment

See [ENTERPRISE_SETUP.md](ENTERPRISE_SETUP.md) for detailed instructions on:
- Windows Group Policy configuration
- macOS MDM setup
- Chrome Enterprise policies
- Preventing extension removal

## Usage

### User Interface

- **Extension Popup**: Click the extension icon to access:
  - Protection toggle (on/off)
  - Request access form (with duration options)
  - Request status display
  - Admin console button (for admins only)

### Admin Console

Access the admin console:
1. Click the extension icon
2. Click "Admin Console" button (visible only to admins)
3. Or navigate to: `chrome-extension://[EXTENSION_ID]/admin.html`
4. Default password: `admin123` (change in production!)

**Admin Console Features:**
- **Requests Tab**: View and approve/deny access requests
- **Active Sessions Tab**: Monitor currently active approved sessions
- **Audit Logs Tab**: View comprehensive audit trail with filtering
- **Devices Tab**: Monitor all devices, track removals, view device information

## Configuration

### Default Admin Password

The default admin password is `admin123`. Change this in production by:
1. Opening admin console
2. The password is stored hashed in Chrome storage
3. Modify `admin.js` to change the default password

### Protection Settings

Protection is enabled by default. Users can toggle it via the extension popup, but admins can monitor all activity through the audit logs.

## Architecture

### Files Structure

```
├── manifest.json          # Extension manifest (Manifest V3)
├── content.js            # Content script (runs on Google Sheets pages)
├── background.js         # Service worker (handles background tasks)
├── popup.html            # Extension popup UI
├── popup.js              # Popup logic
├── admin.html            # Admin console UI
├── admin.js              # Admin console logic
├── ENTERPRISE_SETUP.md   # Enterprise deployment guide
└── README.md             # This file
```

### Key Components

- **Content Script**: Blocks copy/paste events, handles protection logic
- **Background Service Worker**: Manages requests, sessions, device tracking, logging
- **Popup**: User interface for toggling protection and requesting access
- **Admin Console**: Administrative interface for managing the extension

## Device Tracking

The extension automatically tracks all devices where it's installed:

- **Heartbeat**: Devices check in every 5 minutes
- **Device Info**: Collects browser, OS, IP address, and email
- **Removal Detection**: Detects when devices stop checking in (1 hour threshold)
- **Admin Notifications**: Badge count and admin console show removed devices

## Security Notes

**IMPORTANT**: This extension is a **SECURITY FRICTION LAYER**, not absolute security.

It does NOT prevent:
- Screenshots (OS-level or browser extensions)
- Developer Tools inspection
- Network traffic inspection
- Advanced exfiltration methods
- Browser extensions that bypass content scripts

This extension is meant to:
- Reduce casual or accidental copying
- Add friction for unauthorized data extraction
- Work together with DLP solutions and access controls

## Permissions

- `storage`: Store extension state, requests, sessions, logs
- `notifications`: Show badge notifications
- `identity`: Get user email for device tracking
- `https://docs.google.com/spreadsheets/*`: Access Google Sheets pages
- `https://api.ipify.org/*`: Get device IP address

## Development

### Testing

1. Load extension in developer mode
2. Navigate to a Google Sheets document
3. Test copy/paste blocking
4. Test admin console functionality
5. Monitor device tracking in admin console

### Building

No build process required. The extension uses vanilla JavaScript and can be loaded directly.

## License

This project is for internal organizational use.

## Support

For issues or questions:
1. Check the admin console for device status and logs
2. Review [ENTERPRISE_SETUP.md](ENTERPRISE_SETUP.md) for deployment issues
3. Check Chrome extension logs: `chrome://extensions/` → Extension details → Errors

## Changelog

### Version 1.0.0
- Initial release
- Copy/paste blocking
- Admin console
- Request system
- Session management
- Device tracking
- Removal detection
- Audit logging

