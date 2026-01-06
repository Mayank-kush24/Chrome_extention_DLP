# Enterprise Policy Setup Guide

This guide provides instructions for preventing users from removing the Google Sheets Data Protection extension using Enterprise policies.

## Overview

Chrome Extensions cannot prevent their own removal programmatically. To prevent users from removing the extension, you must configure Enterprise policies at the OS/browser level. This guide covers:

- Windows Group Policy setup
- macOS MDM configuration
- Chrome Enterprise policies
- Extension installation and removal prevention

## Prerequisites

- Administrative access to Windows/macOS systems
- Chrome Enterprise policies configured
- Extension ID (found in `chrome://extensions/`)

## Windows Group Policy Setup

### Step 1: Install Chrome ADM/ADMX Templates

1. Download Chrome ADM/ADMX templates from:
   https://www.google.com/chrome/business/browser-management/

2. Extract the templates to:
   - `%SystemRoot%\PolicyDefinitions\` (for ADMX files)
   - `%SystemRoot%\PolicyDefinitions\[Language]\` (for ADML files)

### Step 2: Configure Extension Installation Policy

1. Open **Group Policy Management Console** (gpmc.msc)

2. Navigate to:
   ```
   Computer Configuration → Policies → Administrative Templates → Google → Google Chrome → Extensions
   ```

3. Enable **"Configure the list of force-installed extensions"**

4. Click **"Show"** and add your extension:
   ```
   [YOUR_EXTENSION_ID];https://clients2.google.com/service/update2/crx
   ```
   Replace `[YOUR_EXTENSION_ID]` with your actual extension ID.

5. Enable **"Block all extensions"** and add your extension ID to the exception list:
   ```
   [YOUR_EXTENSION_ID]
   ```

### Step 3: Prevent Extension Removal

1. Navigate to:
   ```
   Computer Configuration → Policies → Administrative Templates → Google → Google Chrome → Extensions
   ```

2. Enable **"Configure extension installation whitelist"** and add your extension ID

3. Enable **"Block extension installation"** and add your extension ID to the exception list

### Step 4: Apply Policy

1. Run `gpupdate /force` on target machines
2. Restart Chrome browsers
3. Verify extension is installed and cannot be removed

## macOS MDM Configuration

### Step 1: Configure Chrome Enterprise Policies

1. Open your MDM console (Jamf, Workspace ONE, etc.)

2. Create a new configuration profile for Chrome

3. Add the following keys:

```xml
<key>ExtensionInstallForcelist</key>
<array>
  <string>[YOUR_EXTENSION_ID];https://clients2.google.com/service/update2/crx</string>
</array>

<key>ExtensionInstallBlocklist</key>
<string>*</string>

<key>ExtensionInstallAllowlist</key>
<array>
  <string>[YOUR_EXTENSION_ID]</string>
</array>
```

### Step 2: Prevent Removal

Add the following preference:

```xml
<key>ExtensionInstallSources</key>
<array>
  <string>https://clients2.google.com/service/update2/crx</string>
</array>
```

### Step 3: Deploy Configuration

1. Assign the configuration profile to target devices
2. Users will not be able to remove the extension

## Chrome Enterprise Policies (JSON)

### For Windows Registry

Create a registry key:
```
HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist
```

Add a string value:
```
Name: 1
Value: [YOUR_EXTENSION_ID];https://clients2.google.com/service/update2/crx
```

### For macOS

Create a plist file at:
```
/Library/Preferences/com.google.Chrome.plist
```

With content:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>ExtensionInstallForcelist</key>
  <array>
    <string>[YOUR_EXTENSION_ID];https://clients2.google.com/service/update2/crx</string>
  </array>
  <key>ExtensionInstallBlocklist</key>
  <string>*</string>
  <key>ExtensionInstallAllowlist</key>
  <array>
    <string>[YOUR_EXTENSION_ID]</string>
  </array>
</dict>
</plist>
```

## Linux Configuration

### For Ubuntu/Debian

1. Create policy file:
   ```bash
   sudo nano /etc/opt/chrome/policies/managed/policy.json
   ```

2. Add content:
   ```json
   {
     "ExtensionInstallForcelist": [
       "[YOUR_EXTENSION_ID];https://clients2.google.com/service/update2/crx"
     ],
     "ExtensionInstallBlocklist": ["*"],
     "ExtensionInstallAllowlist": ["[YOUR_EXTENSION_ID]"]
   }
   ```

3. Restart Chrome

## Verification Steps

1. **Check Extension Installation:**
   - Open `chrome://extensions/`
   - Verify extension is installed
   - Check that "Remove" button is disabled/grayed out

2. **Test Removal Prevention:**
   - Attempt to remove extension via UI
   - Attempt to disable extension
   - Both should be blocked

3. **Check Policy Status:**
   - Open `chrome://policy/`
   - Verify policies are applied correctly
   - Check for any policy errors

## Troubleshooting

### Extension Not Installing

- Verify extension ID is correct
- Check Chrome Enterprise policies are applied
- Review `chrome://policy/` for errors
- Check Chrome logs: `chrome://extensions-internals/`

### Extension Can Still Be Removed

- Verify force-install policy is enabled
- Check ExtensionInstallBlocklist includes "*"
- Ensure ExtensionInstallAllowlist includes your extension ID
- Restart Chrome after policy changes

### Policy Not Applying

- Windows: Run `gpupdate /force` and restart
- macOS: Verify MDM profile is installed
- Linux: Check policy file permissions (should be readable by Chrome)
- Check Chrome version supports Enterprise policies

## Additional Security Recommendations

1. **Disable Developer Mode:**
   - Prevent users from loading unpacked extensions
   - Configure: `ExtensionInstallBlocklist: ["*"]` with allowlist exception

2. **Monitor Extension Status:**
   - Use the admin console to track device removals
   - Set up alerts for removed devices

3. **Regular Audits:**
   - Review device list in admin console weekly
   - Check for unauthorized removals
   - Investigate any removed devices

4. **User Education:**
   - Inform users why extension cannot be removed
   - Provide support contact for issues
   - Document extension functionality

## Policy Reference

### Key Chrome Enterprise Policies

- **ExtensionInstallForcelist**: Forces installation of extensions
- **ExtensionInstallBlocklist**: Blocks extension installation
- **ExtensionInstallAllowlist**: Allows only listed extensions
- **ExtensionInstallSources**: Controls extension installation sources

### Finding Your Extension ID

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Find your extension
4. Copy the ID (long string under extension name)

## Support

For issues with Enterprise policy configuration:

1. Check Chrome Enterprise documentation:
   https://support.google.com/chrome/a/answer/9026537

2. Review Chrome policy templates:
   https://www.google.com/chrome/business/browser-management/

3. Contact your IT administrator for policy deployment assistance

## Notes

- Extension removal prevention requires Enterprise policies
- The extension itself cannot prevent removal programmatically
- Policies must be configured at the OS/browser level
- Users with local admin rights may still be able to modify policies
- Regular monitoring via admin console is recommended

