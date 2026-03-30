Project Orbit - App Icon
=========================

Place your app artwork at `electron/assets/icon.png` (ideally 1024×1024 PNG, square).

Files expected by the build and runtime:
- `electron/assets/icon.png` — source PNG (recommended)
- `electron/assets/icon.ico` — Windows ICO (contains multiple sizes)
- `electron/assets/icon.icns` — macOS ICNS

Quick commands to generate icon files:

- Generate a Windows .ico (cross-platform) using the `png-to-ico` package:

  npx png-to-ico electron/assets/icon.png > electron/assets/icon.ico

- Generate a .ico using ImageMagick (if installed):

  convert electron/assets/icon.png -define icon:auto-resize=256,128,64,48,32,16 electron/assets/icon.ico

- Generate macOS `.icns` on macOS (iconutil):

  mkdir -p electron/assets/icon.iconset
  sips -z 16 16 electron/assets/icon.png --out electron/assets/icon.iconset/icon_16x16.png
  sips -z 32 32 electron/assets/icon.png --out electron/assets/icon.iconset/icon_16x16@2x.png
  sips -z 32 32 electron/assets/icon.png --out electron/assets/icon.iconset/icon_32x32.png
  sips -z 64 64 electron/assets/icon.png --out electron/assets/icon.iconset/icon_32x32@2x.png
  sips -z 128 128 electron/assets/icon.png --out electron/assets/icon.iconset/icon_128x128.png
  sips -z 256 256 electron/assets/icon.png --out electron/assets/icon.iconset/icon_128x128@2x.png
  sips -z 256 256 electron/assets/icon.png --out electron/assets/icon.iconset/icon_256x256.png
  sips -z 512 512 electron/assets/icon.png --out electron/assets/icon.iconset/icon_256x256@2x.png
  sips -z 1024 1024 electron/assets/icon.png --out electron/assets/icon.iconset/icon_512x512@2x.png
  iconutil -c icns electron/assets/icon.iconset -o electron/assets/icon.icns
  rm -rf electron/assets/icon.iconset

- Alternatively, use an npm helper to generate icons cross-platform (example):

  npx electron-icon-maker --input electron/assets/icon.png --output electron/assets

After placing/generating the icon files:

- During development the BrowserWindow will use `electron/assets/icon.*` if present.
- To build the installer with the new icon, run:

  npm ci
  npm run desktop:build

This will create the NSIS installer in the `release/` folder and include the icons.

If you want, paste the image you shared into `electron/assets/icon.png` and I can update the repo to include the file for you (if you provide the PNG file). Otherwise follow the commands above to generate `icon.ico` and `icon.icns` before building.
