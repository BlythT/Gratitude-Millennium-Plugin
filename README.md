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

---

## 🛠 Installation

> [!IMPORTANT]
> **Millennium is required.** This plugin will only work if you have the Millennium framework installed. If you haven't, visit [steambrew.app](https://steambrew.app/) first.

1.  **Download the Plugin:**
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

**Q: Why isn't the gift display loading or isn't showing for a game I was just gifted?**  
A: Visit the Steam Store in your client, then go back! (This plugin stores your game license data but can only do so when you visit the store).

**Q: Can I find this in the [Millennium Plugins Browser](https://steambrew.app/plugins)?**  
A: Not yet; once I've polished this up further, I will submit it for review to be added.  

**Q: Can it show who gifted me the game?**  
A: Unfortunately not. Outside of the original gift message and email, Steam does not store the "sender" information in a way the client can retrieve, so I cannot display it.

## Acknowledgments

A special thanks to **[HLTB for Millennium](https://github.com/jcdoll/hltb-millennium-plugin)** for executing another plugin which places game-specific tooltips: it made a great study/starting out point, especially for the observer and injection logic.

This project uses the **IoGiftSharp** icon from **[Ionicons](https://ionic.io/ionicons)** via **[react-icons](https://react-icons.github.io/react-icons/)**.  
Ionicons and react-icons are licensed under the **MIT License**.
