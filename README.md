> [!CAUTION]
> This plugin example does not work on the stable version of Millennium. (Written on October 26, 2025 — by the time you’re reading this, stable support might have been released. If we forgot to update this note, please let us know.)
>
> Millennium is currently transitioning from Python plugins to Lua plugins. Lua plugin support is available only in the alpha and beta channels — you can find these builds on Millennium’s releases page.
>
> While regular users on the stable channel won’t be able to run your plugin yet, we chose to provide a Lua example early to save you from writing an entire plugin in Python only to have to port it to Lua later.

## Plugin Template

A plugin template for Millennium providing a basic boilerplate to help get started. You'll need a decent understanding in python, and typescript (superset of javascript)
<br>

## Prerequisites

- **[Millennium](https://github.com/SteamClientHomebrew/Millennium)**

## Setting up

```ps1
git clone https://github.com/SteamClientHomebrew/PluginTemplate
cd PluginTemplate
```

## Building

```
pnpm run dev
```

Then ensure your plugin template is in your plugins folder.
`%MILLENNIUM_PATH%/plugins/plugin_template`, and select it from the "Plugins" tab within Steam.

If you wish to develop your plugin outside of `%MILLENNIUM_PATH%/plugins`, you can create a symbolic link from your development path to the plugins path

#### Note:

**MILLENNIUM_PATH** =

- Steam Path (ex: `C:\Program Files (x86)\Steam`) (Windows)
- `~/.local/share/millennium` (Unix)

## Next Steps

https://docs.steambrew.app/developers/plugins/learn
