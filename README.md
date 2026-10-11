# Youtube Cast Receiver (YCR)
> Cast Youtube videos to ANY computer, no chromecast needed!

![](https://img.shields.io/badge/platform-linux--64%20%7C%20osx--64%20%7C%20win--64-green)
![](https://img.shields.io/badge/node%40latest-%3E%3D%206.0.0-green)
![](https://img.shields.io/badge/license-GPL-green)

![](https://github.com/GarrettBlackmon/youtube-cast-receiver/blob/master/assets/icon.png?raw=true)

Youtube Cast Receiver (YCR) was built to allow you to cast Youtube content from your phone directly to your computer. This is very useful while traveling with a laptop and hdmi cable. Leave the chromecast at home!

This is achieved by spoofing the useragent to make your connection appear to come from a smart TV, allowing you to access [youtube.com/tv](https://youtube.com/tv). This app launches in fullscreen mode to give you an immersive and native feeling casting experience.

## Installation

Grab the appropriate binary for your system from the [releases](https://github.com/GarrettBlackmon/youtube-cast-receiver/releases/) page.

On Linux there are a few options. The AppImage is the one to grab if you're not sure - it runs anywhere, no install needed:

```sh
chmod +x youtube-cast-receiver-*.AppImage
./youtube-cast-receiver-*.AppImage
```

No `libfuse2` needed anymore. The AppImage is built on the static runtime, which links FUSE in and only shells out to the `fusermount` helper that ships with every distro's fuse package. If it still complains, `--appimage-extract-and-run` always works.

If you'd rather have it show up in your app menu like a normal program, there's a `.deb`, an `.rpm`, and a `.pacman` for Arch (`sudo pacman -U youtube-cast-receiver-*.pacman`).

## Linking your device

### 1: Open the application and click the settings icon

![step1](https://i.imgur.com/WLl57WN.png)


### 2: Click "LINK WITH TV CODE"

![step2](https://i.imgur.com/J0Awy33.png)


### 3: Note the TV code on your screen

![step3](https://i.imgur.com/bhmCurr.png)


### 4: Open the Youtube app on your smartphone and click your photo in the top right
<img src="https://i.imgur.com/wcA32XI.png" height="500px">



### 5: Tap "Settings"
<img src="https://i.imgur.com/wcA32XI.png" height="500px">



### 6: Tap "Watch on TV"
<img src="https://i.imgur.com/TrBpOjk.png" height="500px">


### 7: Tap "Enter TV code"
<img src="https://i.imgur.com/2kEBacS.png" height="500px">


### 8: Enter the code on your computer screen in the box and press "Link"
<img src="https://i.imgur.com/gCKYXlz.png" height="500px">


## Ad blocking and sponsor skipping

YCR comes with two browser extensions running inside the TV interface:

* [uBlock Origin](https://github.com/gorhill/uBlock) blocks ads and trackers, using its default filter lists. YouTube only opens once uBlock Origin has its lists loaded, a second or so after launch (a few more the very first time), so nothing slips through while it starts up.
* [SponsorBlock](https://github.com/ajayyy/SponsorBlock) skips the sponsored parts of videos, using the segments people submit to [sponsor.ajay.app](https://sponsor.ajay.app). Out of the box it skips sponsors automatically and leaves the other categories alone.

Their settings are in the **Add-ons** menu. The menu bar stays hidden in fullscreen, so press F11 to leave fullscreen and then Alt to bring it up (on macOS it's in the menu bar at the top of the screen). In SponsorBlock's settings you can set intros, outros, self promotion and the rest to "Auto skip" too; nobody is holding a mouse to click a skip button on a TV, so auto skip is the setting that matters here. Changes apply straight away, even to the video that's already playing.


## Release History

* 0.1.0
    * Work in progress - compiled for Linux/MacOS
* 1.0.0
    * Official release - compiled for Windows/MacOS/Linux
* 1.0.1
    * Bugfix - removed menubar on windows distribution
* 1.0.2
    * Electron 12 -> 43, fixed the build pipeline, added AppImage/rpm/pacman builds for Linux
* 1.0.3
    * Shows a start screen instead of a blank window when there's no connection, static AppImage runtime (no libfuse2), dropped 'linux' from the AppImage file name




## Contributing

1. Fork it (<https://github.com/yourname/yourproject/fork>)
2. Create your feature branch (`git checkout -b feature/fooBar`)
3. Commit your changes (`git commit -am 'Add some fooBar'`)
4. Push to the branch (`git push origin feature/fooBar`)
5. Create a new Pull Request

## Development

To run the project locally with npm:

```sh
git clone https://github.com/GarrettBlackmon/youtube-cast-receiver
npm i
npm run start
```

`npm i` also downloads uBlock Origin and SponsorBlock into `extensions/unpacked` (`npm run fetch-extensions` does just that part). Behind a proxy, set `NODE_USE_ENV_PROXY=1` so Node uses your `HTTPS_PROXY` for the download.

### The browser extensions

The extension versions are pinned in `extensions/sources.json`, each with the release zip it comes from and that zip's sha256. They are used as released, except that each one gets a compatibility shim from `extensions/shims` loaded ahead of its own code. Electron only implements part of Chrome's extension API, and the shims fill in what's missing: for uBlock Origin, the toolbar, context menu and stylesheet calls it makes, and for SponsorBlock, the `chrome.storage.sync` it keeps its settings in.

To move to a newer release, change the version, URL and sha256 in `sources.json` and run `npm run fetch-extensions`. If the checksum is wrong the script stops and prints the one it got.

To build for your own platform:

```sh
npx electron-builder --linux    # or --mac / --windows
```

Builds land in `dist/`. `npm run build-local` does all three at once, but cross-building mac and windows off their own OS needs extra tooling, so CI handles that.

## Meta

Garrett Blackmon – [@GarrettBlackmon](https://twitter.com/garrettblackmon) – garrett@blackmon.dev

Distributed under the GPL license.
