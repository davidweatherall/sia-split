# Sia Split

This is a desktop tool that inputs a video file and splits it into smaller chunks at different quality levels, that can be uploaded to Sia. The tool also generates HLS playlists for each quality level, so that the video can be efficiently streamed from the Sia network.

# Installation

## Prerequisites

- Node.js 16 or higher
- Renterd running either locally or remotely, set up with a public key, private key and an s3 url.
- A Sia wallet with some SC in it.
- Windows

## Installation

- Clone this repository
- Run `npm install`
- Run `npm run build`
- Run `npm run start`

# Usage

- Select a video file to upload
- Select quality levels to split the video into
- Split the video
- Upload the video to Sia
- Ensure the bucket has public read access
- Copy the manifest url and paste it into the video player of your choice

# Development

## Renderer

The frontend is built using React, all of the code is on a single page, located at `src/App.tsx`. This is where the UI is defined and the logic for selecting quality levels / the video file is implemented.

## Main

The backend is built using Electron, all of the code is located at `main.js`. This is where the logic for splitting the video using a custom ffmpeg command is implemented, as well as the logic for uploading the video to Sia using the minio client.

# Developing for other platforms

The tool is currently only built for Windows, but it should be possible to build it for other platforms as well. The ffmpeg command used to split the video is platform agnostic, so it should work on any platform, would need to check this runs correclty though. The minio client is platform agnostic, but it currently only has the prebuilt application for Windows. To build the application for other platforms, you would need to download the minio client for that platform and replace the `minio.exe` file in the root folder with the one for the platform you want to build for. In the functions that run inside the 'upload' scripts in the `main.js` file, you would need to determine the platform and run the correct minio client.

# License

MIT