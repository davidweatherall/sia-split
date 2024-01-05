import { app, BrowserWindow, ipcMain, shell } from 'electron';
import fs from 'fs';
import fetch from 'node-fetch';
import { spawn } from 'child_process';
import { v4 } from "uuid";
import contextMenu from 'electron-context-menu';

import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffProbeStatic from 'ffprobe-static';
//Get the paths to the packaged versions of the binaries we want to use
const ffmpegPath = ffmpegStatic.replace(
  'app.asar',
  'app.asar.unpacked'
);
const ffprobePath = ffProbeStatic.path.replace(
  'app.asar',
  'app.asar.unpacked'
);
//tell the ffmpeg package where it can find the needed binaries.
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);


contextMenu();

// Generic boilerplate electron stuff

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1800,
    height: 1000,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  })

  win.loadFile('index.html')
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
});

const mainBucketName = 'siasplit-output';

const setupMc = (s3Url, accessKey, secretKey) => {
  return new Promise((resolve, reject) => {
    const mcAlias = spawn('./mc.exe', ['alias', 'set', 'renterd', s3Url, accessKey, secretKey]);

    mcAlias.stdout.on('data', (data) => {
      if(data.toString().includes('Added `renterd` successfully.')) {
        resolve();
      }
    });
    
    mcAlias.stderr.on('data', (data) => {
      reject(data);
    });
    
    mcAlias.on('close', (code) => {
      console.log(`child process exited with code ${code}`);
    });
  });
}

const uploadData = (bucketName, event) => {
  console.log('uploading');
  return new Promise((resolve, reject) => {
    const mcUpload = spawn('./mc.exe', ['cp', '--recursive', 'output', `renterd/${mainBucketName}/${bucketName}`]);

    mcUpload.stdout.on('data', (data) => {
      console.log(`stdout: ${data}`);
      event.reply('uploading-status', `Uploading data to bucket ${bucketName} - ${data}`);
    });
    
    mcUpload.stderr.on('data', (data) => {
      console.log(`stderr: ${data}`);
      reject(data);
    });
    
    mcUpload.on('close', (code) => {
      console.log(`child process exited with code ${code}`);
      resolve();
    });
  });
}

const createBucketsIfNotExist = (bucketName) => {
  return new Promise((resolve, reject) => {
    const mcBucket = spawn('./mc.exe', ['mb', `renterd/${mainBucketName}/${bucketName}`]);

    mcBucket.stdout.on('data', (data) => {
      console.log(`stdout: ${data}`);
      resolve();
    });
    
    mcBucket.stderr.on('data', (data) => {
      console.log(`stderr: ${data}`);
      reject(data);
    });
    
    mcBucket.on('close', (code) => {
      console.log(`child process exited with code ${code}`);
    });
  });
}

const moveData = (bucketName) => {
  console.log('moving data');
  return new Promise((resolve, reject) => {
    const mcMove = spawn('./mc.exe', ['mv', '--recursive', `renterd/${mainBucketName}/${bucketName}/output/`, `renterd/${mainBucketName}/${bucketName}`]);

    mcMove.stdout.on('data', (data) => {
      console.log(`stdout: ${data}`);
    });

    mcMove.stderr.on('data', (data) => {
      console.log(`stderr: ${data}`);
      reject(data);
    });

    mcMove.on('close', (code) => {
      console.log(`child process exited with code ${code} - moveData`);
      resolve();
    });
  });
}


ipcMain.on('upload', async (event, arg) => {

  event.reply('uploading', true);

  const s3Url = arg.s3Url;
  const hostUrl = arg.hostUrl || s3Url;
  const accessKey = arg.accessKey;
  const secretKey = arg.secretKey;

  event.reply('uploading-status', `Setting up mc.exe to work with renterd`);
  await setupMc(s3Url, accessKey, secretKey);

  const bucketName = v4();
  event.reply('uploading-status', `Creating bucket ${bucketName}`);
  await createBucketsIfNotExist(bucketName);

  event.reply('uploading-status', `Uploading data to bucket ${bucketName}`);
  await uploadData(bucketName, event);

  event.reply('uploading-status', `Moving data to root of bucket ${bucketName}`);
  await moveData(bucketName);

  event.reply('uploading-status', `Upload complete`);
  event.reply('uploading', false);
  event.reply('uploaded-m3u8-path', `${hostUrl}/${mainBucketName}/${bucketName}/video_master.m3u8`);
});

ipcMain.on('split-video', async (event, arg) => {

  event.reply('splitting', true);

  event.reply('splitting-status', `Creating directories`);

  if (fs.existsSync('./output')) {
    fs.rmdirSync('./output', { recursive: true });
  }

  fs.mkdirSync('./output');

  const videoSource = arg.videoSourcePath;
  const qualities = arg.qualities;

  const variantPlaylists = [];
  for (let i = 0; i < qualities.length; i++) {
    const { resolution, videoBitRate, audioBitRate } = qualities[i];
    event.reply('splitting-status', `Splitting video into ${resolution}`);
    console.log(`HLS conversion starting for ${resolution} ${videoBitRate} ${audioBitRate}`);
    const outputFileName = `video_${resolution}.m3u8`;
    const segmentFileName = `video_${resolution}_%03d.ts`;

    const SIA_MIN_CHUNK_SIZE_IN_BITS = 4 * 1024 * 1024 * 8;

    let hlsTime = 10;
    let bandwidth = 0;

    if(videoBitRate && audioBitRate) {
      bandwidth = (parseInt(videoBitRate) * 1000) + (parseInt(audioBitRate) * 1000);
      console.log('total bit rate', bandwidth);
      const numberOfSeconds = Math.floor(SIA_MIN_CHUNK_SIZE_IN_BITS / bandwidth);
      console.log('number of seconds', numberOfSeconds);
      hlsTime = numberOfSeconds;
      if(hlsTime < 10) {
        hlsTime = 10;
      }
    } else {
      // calculate bandwidth using ffmpeg
      const ffprobeData = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(videoSource, (err, data) => {
          if(err) {
            reject(err);
          }
          resolve(data);
        });
      });

      console.log('ffprobe', ffprobeData);

      bandwidth = ffprobeData.format.bit_rate;
    }

    console.log('BITRATE@', bandwidth);

    await new Promise((resolve, reject) => {
      const outputOptions = [
        `-c:v h264`,
        videoBitRate ? `-b:v ${videoBitRate}` : ``,
        `-c:a aac`,
        audioBitRate ? `-b:a ${audioBitRate}` : ``,
        `-vf scale=${resolution}`,
        `-f hls`,
        `-hls_time ${hlsTime}`,
        `-hls_list_size 0`,
        `-hls_segment_filename output/${segmentFileName}`
      ].filter((option) => option !== ``);
      ffmpeg(videoSource)
        .outputOptions(outputOptions)
        .output(`output/${outputFileName}`)
        .on('end', () => resolve())
        .on('progress', (progress) => {
          console.log(`HLS conversion progress for ${resolution}: ${progress.percent}%`);
          const percent = progress.percent >= 0 ? progress.percent.toFixed(1) : 0;
          event.reply('splitting-status', `Splitting video into ${resolution} ${percent}%`);
        })
        .on('stderr', (stderrLine) => {
          // console.log(`HLS conversion stderr for ${resolution}: ${stderrLine}`);
        })
        .on('error', (err) => {
          console.log(`HLS conversion error for ${resolution}`);
          event.reply('splitting-status', `Split video failed for ${resolution} - ${err}`);
          console.log(err);
          reject(err);
        })
        .run();
    });
    const variantPlaylist = {
      resolution,
      outputFileName,
      bandwidth,
    };
    variantPlaylists.push(variantPlaylist);
    console.log(`HLS conversion done for ${resolution}`);
  }
  console.log(`HLS master m3u8 playlist generating`);
  
  event.reply('splitting-status', `Generating master playlist`);

  let masterPlaylist = variantPlaylists
    .map((variantPlaylist) => {
      const { resolution, outputFileName, bandwidth } = variantPlaylist;

      return `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution}\n${outputFileName}`;
    })
    .join('\n');
  masterPlaylist = `#EXTM3U\n` + masterPlaylist;

  const masterPlaylistFileName = `video_master.m3u8`;
  const masterPlaylistPath = `output/${masterPlaylistFileName}`;
  fs.writeFileSync(masterPlaylistPath, masterPlaylist);
  console.log(`HLS master m3u8 playlist generated`);

  event.reply('splitting-status', `Video successfully split - ready for upload`);
  event.reply('splitting', false);
});

ipcMain.on('open-link', async (event, arg) => {
  shell.openExternal(arg);
})