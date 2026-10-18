# Gratitude - Gifted Games Reminder

**Gratitude** is a [Millennium](https://steambrew.app/) plugin for your Steam Library that adds a helpful indicator to games you have been gifted.

## Screenshots

<p align="center">
  <img src="assets/big.png" width="80%" alt="Full UI Integration">
  <br>
  <em>The plugin integrates seamlessly with the existing Steam game header.</em>
</p>

<p align="center">
  <img src="assets/small.png" width="40%" alt="Tooltip Detail">
</p>

### Big Picture Mode

Gratitude also works in Big Picture mode, providing the same gift information when browsing your library on the big screen.

<p align="center">
  <img src="assets/bigpicturemode.png" width="80%" alt="Big Picture Mode Integration">
  <br>
  <em>Full Big Picture mode support for couch gaming.</em>
</p>

<p align="center">
  <img src="assets/small(big)picturemode.png" width="40%" alt="Big Picture Mode Tooltip">
</p>

### Gift Labeling ![NEW!](https://img.shields.io/badge/-NEW!-FFB347)
Ever forgotten who gave you a game?

| | |
|:---|:---:|
| Click the gift icon on any gifted game to open a details panel where you can record the gifter and add a personal note. | <a href="https://github.com/user-attachments/assets/8de0754f-ceba-45df-8fc8-fd237b7b1ce6"><img src="https://github.com/user-attachments/assets/8de0754f-ceba-45df-8fc8-fd237b7b1ce6" width="250" alt="Gift details panel"></a> |
| <a href="https://github.com/user-attachments/assets/11bc1278-38fa-4a3c-81c5-6e8e19df4706"><img src="https://github.com/user-attachments/assets/11bc1278-38fa-4a3c-81c5-6e8e19df4706" width="250" alt="Friend autocomplete"></a> | The gifter field uses smart autocomplete against your Steam friends list, so you can find the right person without typing their full name. |
| Once saved, the gifter's name shows up right in the tooltip so you never forget again! | <a href="https://github.com/user-attachments/assets/0af398fa-559e-4196-977e-aefac28d6af8"><img src="https://github.com/user-attachments/assets/0af398fa-559e-4196-977e-aefac28d6af8" width="250" alt="Gifter shown on hover"></a> |

## 🛠 Installation

> [!IMPORTANT]
> **Millennium is required.** This plugin will only work if you have the Millennium framework installed. If you haven't, visit [steambrew.app](https://steambrew.app/) first.

### Either: 
1.  **Install from the Gratitude plugin page:**
    * Open [Gratitude on steambrew.app](https://steambrew.app/plugin?id=a0f319c49e93).
    * Use the install flow there. This is the recommended way to install the plugin.

Or:
1.  **Manual install fallback:**
    * Click the **Releases** section on the right side of this repository.
    * Under the latest version, look for the **Assets** dropdown.
    * Download the file named `gratitude-for-millenium-<version>.zip`.
2.  **Locate Plugins Directory:**
    * Go to your Steam installation folder (often `C:\Program Files (x86)\Steam\plugins`). 
    * *Note: This folder is only created after Millennium has been installed and run for the first time.*
3.  **Extract:**
    * Extract the contents of the ZIP file into a new folder within that `plugins` directory.
4.  **Restart Steam (if it was open):**
    * Once Steam restarts, Millennium will load the plugin but it still needs to be enabled.
5.  **Enable the Plugin:**
    * Go to **Steam** → **Millennium** → **Plugins** in the menu bar.
    * Find **Gratitude** in the list and toggle it on.
    * "Save Changes"

---

# FAQ
**Q: Is Millennium allowed by Valve? (Will I get banned?)**   
A: Using Millennium to customize your client is safe. As noted on the [Official Valve Software Wiki](https://developer.valvesoftware.com/wiki/Steam_Skins):   
> "As the official skin support (for VGUI) has been removed... it was unofficially replaced by Millennium for Steam... an open source patcher that allows skins/themes after April 27th 2023."

**Q: Does this work in Big Picture mode?**  
A: Yes! Gratitude fully supports both the standard Steam library and Big Picture mode.

**Q: Why isn't the gift display loading or isn't showing for a game I was just gifted?**  
A: Try visiting the Steam Store in your client, then go back: This plugin stores your game license data but can only do so when you visit one of Steam's non-library pages.

**Q: Can it show who gifted me the game?**  
A: Yes, with a little help from you! Steam doesn't store sender information in a way the client can retrieve, but you can label it yourself. Click the `Gifted` tooltip on any gifted game in your Library to open the details panel, where you can select the gifter from your Steam friends list and add a personal note. Once saved, the gifter's name will appear in the tooltip.

### Matching Harness
If you want to debug library-title vs license-name mismatches, there is a small report tool in `tools/license-match-report.mjs`.

- Run it with `npm run match:licenses -- --cache backend/gratitude_cache.json --dom path/to/snapshots`
- It accepts a single saved `.html` snapshot, a folder of snapshots, or a plain text file of titles
- The report shows exact matches, the plugin's current prefix-based fuzzy matches, normalized-only matches, and misses

## Where Gratitude stores your data

On Millennium 3.0.0 or later, your gift details (who gave you each game, and your notes), your storage permission choice and your settings are kept in Millennium's plugin config. That is a file Millennium manages outside Gratitude's plugin folder: `~/.config/millennium/config.json` on Linux, or `<Steam>\millennium\config\config.json` on Windows.

The licence and friends caches, which Gratitude can rebuild from Steam at any time, are kept as files in Gratitude's plugin folder.

On Millennium older than 3.0.0, everything is kept as files in Gratitude's plugin folder.

### Moving from the old files

When Gratitude finds your data in its old files, it copies it into Millennium's config and, on a later start, renames each old file to `<name>.migrated`. These copies stay in the plugin folder with your gift details as they were at that point, so deleting or editing a gift afterwards doesn't change them. Gratitude never deletes them: you can delete them by hand once your gifts show up, and uninstalling removes them with the plugin folder.

Earlier Gratitude versions, which don't use Millennium's plugin config, only read the old files. To go back to one, first rename each `.migrated` file back to its original name. If a file has several copies, such as `gratitude_givers.json.migrated.1760000000`, use the one with the highest number: the plain `.migrated` copy is the oldest. Changes made while on the earlier version, including your storage permission choice, won't carry over when you update again.

### Uninstalling

Uninstalling Gratitude from Millennium's settings deletes its plugin folder, including the licence and friends caches, but keeps your gift details, storage permission choice and settings in Millennium's config, so they come back if you reinstall. Deleting the plugin folder by hand does the same.

Some Millennium versions may also ask whether to delete Gratitude's saved settings: answering yes deletes your gift details too, even though the prompt only says "settings".

On Millennium older than 3.0.0, uninstalling deletes everything Gratitude saved.

Nothing is stored in the cloud. Removing Millennium as its [uninstall guide](https://docs.steambrew.app/users/parting-ways/uninstall) describes removes Gratitude's data too, but on some Linux systems the guide has you delete Millennium's config folder (`~/.config/millennium`) by hand, and your gift details stay in it until you do.

## Acknowledgments

A special thanks to **[HLTB for Millennium](https://github.com/jcdoll/hltb-millennium-plugin)** for executing another plugin which places game-specific tooltips: it made a great study/starting out point, especially for the observer and injection logic.

This project uses the **IoGiftSharp** icon from **[Ionicons](https://ionic.io/ionicons)** via **[react-icons](https://react-icons.github.io/react-icons/)**.  
Ionicons and react-icons are licensed under the **MIT License**.
