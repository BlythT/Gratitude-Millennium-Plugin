# Millennium Plugin Development Guide (agents.md)

This document provides a guide to developing plugins on the **Millennium** framework, detailing Steam's CEF architecture, developer tools, the `SharedJSContext`, context separation APIs, and submission procedures.

---

## 1. Millennium Addon Landscape

Millennium supports two primary types of addons:
- **Themes**: Alter the visual styling and layout using CSS.
- **Plugins**: Extend functionality by hooking into Steam's runtime, scripting CEF views, or executing native filesystem and network code.

---

## 2. Steam Architecture & Modification Environment

### 2.1 Chromium Embedded Framework (CEF)
Steam is a desktop application shell wrapping the **Chromium Embedded Framework (CEF)**. 
- The native desktop layer handles operating system integration (hardware detection, filesystem, game launching).
- The presentation layer runs Chromium to render views.
- Millennium works by injecting custom JavaScript/TypeScript scripts into these CEF renders, allowing direct manipulation of the layout and hooks into Steam's APIs.

### 2.2 React UI Layer
Steam's interface is built on **React** bundled with **Webpack**. 
- Common elements (game library cards, chat tabs, store cards) are rendered as React components.
- Plugins can patch Steam's React component tree (e.g. using patch hooks or search selectors) to inject elements seamlessly without breaking existing Steam visual design.

---

## 3. The SharedJSContext

The **`SharedJSContext`** is the headless execution container of the Steam Client:
- **Brain of Steam**: It manages window lifetimes, session logins, library data, game installations, and downloads.
- **headless View**: Unlike normal client windows, it runs in the background and controls other browser views.
- **Key Target**: High-privilege actions (like interception of game launches or hook setups) are typically target-injected here.

---

## 4. Millennium Developer SDK Packages

The plugin framework provides segmented NPM packages targeted at specific runtime contexts:

| Package Name | Executed Context | Purpose & Features |
| :--- | :--- | :--- |
| **`@steambrew/client`** | Frontend (Library/Popups) | Provides React UI elements (`Field`, `ToggleField`, `DialogButton`), hooks, icons (`IconsModule`), and the plugin boundary definition (`definePlugin`, `callable`). |
| **`@steambrew/webkit`** | Webkit (Store/Community) | Provides page-level hooks (`callable`) running in webviews. Designed to work in plain browser pages without React component dependencies. |
| **`@steambrew/api`** | Multi-Context | Houses generic interface typings, enums, client window control schemas, and lower-level messaging. |
| **`@steambrew/ttc`** | Build Environment | Compilation toolchain compiler (`millennium-ttc`) used to compile, bundle, and minify source scripts into `.millennium/Dist/`. |

---

## 5. Setting Up the Developer Environment

### 5.1 Activating Dev Mode
To enable client debugging, launch Steam with the `-dev` command-line argument:
- **Windows**: Create a shortcut to `steam.exe` and append ` -dev` to the Target field (e.g. `"C:\Program Files (x86)\Steam\steam.exe" -dev`).
- **Linux**: Start steam from the terminal using `steam -dev`.

### 5.2 Launching DevTools
- Focus the target Steam window and press **`Ctrl` + `Shift` + `I`** or **`F10`**.
- Alternatively, open **`http://127.0.0.1:8080`** in a Chrome/Chromium-based browser to select and debug active pages.
- *Note: Avoid Firefox for client debugging, as it regularly breaks DevTools features connected to Steam's CEF.*

---

## 6. Submission and Lifecycle

- **Submission Portals**:
  - **Themes**: Submitted by opening a theme-detailing issue on the [Millennium Repository](https://github.com/SteamClientHomebrew/Millennium).
  - **Plugins**: Submitted via a Pull Request to the [Plugin Database Repository](https://github.com/SteamClientHomebrew/PluginDatabase).
- **Approved State**: Once merged, plugins appear on [steambrew.app](https://steambrew.app). The site parses the plugin's repository `README.md` and displays it to users.
- **Update Workflow**: Plugins **do not** auto-update. When updates are released, a new PR must be opened against the Plugin Database for safety review.
