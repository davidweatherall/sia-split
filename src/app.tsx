import React, { useEffect, useRef, useState } from "react";
import styles from "./home.module.css";
import { ipcRenderer, clipboard } from "electron";
import Hls from "hls.js";

enum QualityOptions {
  "240p" = "240p",
  "360p" = "360p",
  "480p" = "480p",
  "720p" = "720p",
  "1080p" = "1080p",
  "Source" = "Source",
}

type SplitVideoConfig = {
  videoSourcePath: string;
  qualities: {
    key: QualityOptions;
    resolution: string;
    videoBitRate?: string;
    audioBitRate?: string; 
  }[];
}

type QualityMap = {
  [key in QualityOptions]?: {
    height: number;
    videoBitRate: string;
    audioBitRate: string;
  }
}

interface Settings {
  s3Url: string;
  hostUrl: string;
  accessKey: string;
  secretKey: string;
}

// TODO: make this configurable?
const qualityMaps: QualityMap = {
  "240p": {
    height: 240,
    videoBitRate: "500k",
    audioBitRate: "64k",
  },
  "360p": {
    height: 360,
    videoBitRate: "800k",
    audioBitRate: "90k",
  },
  "480p": {
    height: 480,
    videoBitRate: "1000k",
    audioBitRate: "128k",
  },
  "720p": {
    height: 720,
    videoBitRate: "2500k",
    audioBitRate: "192k",
  },
  "1080p": {
    height: 1080,
    videoBitRate: "4500k",
    audioBitRate: "300k"
  }
}

const App = () => {

  const qualitiesToShow = [
    QualityOptions["240p"],
    QualityOptions["360p"],
    QualityOptions["480p"],
    QualityOptions["720p"],
    QualityOptions["1080p"],
    QualityOptions["Source"],
  ];

  const [activeQualities, setActiveQualities] = useState<QualityOptions[]>([]);
  const [settingsOpen, setSettingsOpen] = useState<boolean>(() => {
    const existingSettings = localStorage.getItem("settings");
    if(!existingSettings) {
      return true;
    }
    const parsedExistingSettings = JSON.parse(existingSettings) as Settings;
    return !Boolean(parsedExistingSettings.s3Url && parsedExistingSettings.accessKey && parsedExistingSettings.secretKey);
  });
  const [videoSource, setVideoSource] = useState<string | null>(null);
  const [videoSourcePath, setVideoSourcePath] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string>("");
  const [isSplitting, setIsSplitting] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [hasSplitVideo, setHasSplitVideo] = useState<boolean>(false);
  const [hasUploadedVideo, setHasUploadedVideo] = useState<boolean>(false);
  const [uploadedM3u8Path, setUploadedM3u8Path] = useState<string | null>(null);
  const [hasCopied, setHasCopied] = useState<boolean>(false);
  const [settings, setSettings] = useState<Settings>(() => {
    const existingSettings = localStorage.getItem("settings");
    if(existingSettings) {
      return JSON.parse(existingSettings);
    }
    return {
      s3Url: "",
      hostUrl: "",
      accessKey: "",
      secretKey: "",
    }
  })
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleQualityLevelClick = (qualityLevel: QualityOptions) => {
    setActiveQualities(qualities => {
      if(qualities.includes(qualityLevel)) {
        return qualities.filter(q => q !== qualityLevel);
      }
      return [...qualities, qualityLevel];
    })
  }

  const handleSplitClick = () => {

    if(!videoRef.current) return;

    setHasSplitVideo(false);

    const video = videoRef.current;
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;

    const aspectRatio = videoWidth / videoHeight;

    const qualities: SplitVideoConfig['qualities'] = activeQualities
      .sort((a, b) => Object.keys(QualityOptions).indexOf(a) - Object.keys(QualityOptions).indexOf(b))
      .map(q => {
        const qualityMap = qualityMaps[q];
        if(qualityMap) {
          let width = parseInt((qualityMap.height * aspectRatio).toString());
          if(width % 2 !== 0) width += 1; 
          return {
            key: q,
            resolution: `${width}x${qualityMap.height}`,
            videoBitRate: qualityMap.videoBitRate,
            audioBitRate: qualityMap.audioBitRate,
          }
        }
        return {
          key: q,
          resolution: `${videoWidth}x${videoHeight}`,
        }
      });

    const splitVideoConfig: SplitVideoConfig = {
      videoSourcePath: videoSourcePath!,
      qualities: qualities,
    }

    ipcRenderer.send("split-video", splitVideoConfig);
  }

  const handleUploadClick = () => {
    
    const { s3Url, hostUrl, accessKey, secretKey } = settings;
    if(!s3Url || !accessKey || !secretKey) {
      setSettingsOpen(true);
      return;
    }

    ipcRenderer.send("upload", {
      s3Url,
      hostUrl,
      accessKey,
      secretKey,
    });
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if(!e.target.files) return;
    const file = e.target.files[0];
    if(file) {
      setVideoSource(URL.createObjectURL(file));
      setVideoSourcePath(file.path);
    }
  }

  const handleSelectVideoClick = () => {
    inputRef.current?.click();
  }

  const handleUploadStatusChange = (status: string) => {
    setStatusText(status);
  }  

  const handleM3u8CopyClick = () => {
    if(!uploadedM3u8Path) return;
    setHasCopied(true);
    clipboard.writeText(uploadedM3u8Path);

    setTimeout(() => {
      setHasCopied(false);
    }, 3000);
  }


  useEffect(() => {

    ipcRenderer.on("splitting-status", (event, status) => {
      handleUploadStatusChange(status);
    });

    ipcRenderer.on("uploading-status", (event, status) => {
      handleUploadStatusChange(status);
    });

    ipcRenderer.on("uploaded-m3u8-path", (event, path) => {
      setUploadedM3u8Path(path);
    });

    ipcRenderer.on("splitting", (event, isSplitting) => {
      setIsSplitting(isSplitting);
      if(isSplitting === false) {
        setHasSplitVideo(true);
      }
    });

    ipcRenderer.on("uploading", (event, isUploading) => {
      setIsUploading(isUploading);
      if(isUploading === false) {
        setHasUploadedVideo(true);
      }
    });

    return () => {
      ipcRenderer.removeAllListeners("splitting-status");
      ipcRenderer.removeAllListeners("splitting");
      ipcRenderer.removeAllListeners("uploading-status");
      ipcRenderer.removeAllListeners("uploading");
      ipcRenderer.removeAllListeners("uploaded-m3u8-path");
    }
  }, []);

  useEffect(() => {
    setHasSplitVideo(false);
    setHasUploadedVideo(false);
    setUploadedM3u8Path(null);
  }, [videoSource, activeQualities]);

  useEffect(() => {
    localStorage.setItem("settings", JSON.stringify(settings));
  }, [settings]);

  return (
    <main className={styles.main}>
      { settingsOpen && (
        <div className={styles.settings} onClick={() => setSettingsOpen(false)}>
          <div className={styles.settingsInner} onClick={e => e.stopPropagation()}>
            <div className={styles.settingsTitle}>Settings</div>
            <div className={styles.settingsSection}>
              <div className={styles.settingsInputGroup}>
                <label className={styles.settingsInputLabel}>S3 URL</label>
                <input className={styles.settingsInput} value={settings.s3Url} onChange={e => setSettings(settings => ({...settings, s3Url: e.target.value}))} placeholder="http://localhost:9885" />
              </div>
              <div className={styles.settingsInputGroup}>
                <label className={styles.settingsInputLabel}>External Host URL (Optional)</label>
                <input className={styles.settingsInput} value={settings.hostUrl} onChange={e => setSettings(settings => ({...settings, hostUrl: e.target.value}))} placeholder="https://cdn.example.com" />
              </div>
              <div className={styles.settingsInputGroup}>
                <label className={styles.settingsInputLabel}>Access Key</label>
                <input className={styles.settingsInput} value={settings.accessKey} onChange={e => setSettings(settings => ({...settings, accessKey: e.target.value}))} placeholder="S3 Access Key" />
              </div>
              <div className={styles.settingsInputGroup}>
                <label className={styles.settingsInputLabel}>Secret Key</label>
                <input className={styles.settingsInput} value={settings.secretKey} onChange={e => setSettings(settings => ({...settings, secretKey: e.target.value}))} placeholder="S3 Secret Key" />
              </div>
              <button className={styles.settingsSaveButton} onClick={() => setSettingsOpen(false)}>Save</button>
            </div>
          </div>
        </div>
      )}
      <h1 className={styles.title}>SiaSPLIT</h1>
      <div className={styles.settingsToggle} onClick={() => setSettingsOpen(!settingsOpen)}>Settings</div>
      { videoSource ? 
        <div className={styles.videoHolder}>
          <video className={styles.video} src={videoSource} controls ref={videoRef}></video>
          <a onClick={() => setVideoSource(null)} className={styles.removeVideo}>Remove Video</a>
        </div>
        : (
          <div className={styles.uploadBox} onClick={handleSelectVideoClick}>
            <input className={styles.uploadInput} type="file" accept="video/*" onChange={handleFileChange} ref={inputRef} />
            <div className={styles.uploadText}>Select Video</div>
          </div>
        )
      }
      <div className={styles.qualityLevels}>
        {qualitiesToShow.map(q => (
          <div className={`${styles.qualityLevel} ${!activeQualities.includes(q) && styles.qualityLevelInactive}`} key={q} onClick={() => handleQualityLevelClick(q)}>
            <div className={styles.qualityLevelTitle}>{q}</div>
          </div>
        ))}
      </div>
      { hasSplitVideo ? (
        <button className={styles.splitButton} onClick={handleUploadClick} disabled={isUploading}>Upload</button>
      ) : (
        <button className={styles.splitButton} onClick={handleSplitClick} disabled={isSplitting}>Split Video</button>
      )}
      <div className={styles.statusText}>{ statusText }</div>
      { hasUploadedVideo && uploadedM3u8Path && (
        <div className={styles.linkHolder}>
          <div className={styles.uploadedLink}>{ uploadedM3u8Path }</div>
          <button className={styles.copyButton} onClick={handleM3u8CopyClick}>{ hasCopied ? "Copied!" : "Copy" }</button>
        </div>
      )}
    </main>
  );
}

export default App;
