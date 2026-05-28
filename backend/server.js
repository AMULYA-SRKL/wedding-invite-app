const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { execSync, spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

let FFMPEG_PATH = 'ffmpeg';
let FFPROBE_PATH = 'ffprobe';

try {
  FFMPEG_PATH = require('@ffmpeg-installer/ffmpeg').path;
  FFPROBE_PATH = require('@ffprobe-installer/ffprobe').path;
  console.log('✅ FFmpeg :', FFMPEG_PATH);
  console.log('✅ FFprobe:', FFPROBE_PATH);
} catch {
  console.log('ℹ️ Using system FFmpeg from PATH');
}

const BASE_DIR = __dirname;
const UPLOADS_DIR = path.join(BASE_DIR, 'uploads');
const OUTPUTS_DIR = path.join(BASE_DIR, 'outputs');
const FONTS_DIR = path.join(BASE_DIR, 'fonts');

console.log('📁 BASE_DIR   :', BASE_DIR);
console.log('📁 FONTS_DIR  :', FONTS_DIR);

[UPLOADS_DIR, OUTPUTS_DIR, FONTS_DIR].forEach(d =>
  fs.mkdirSync(d, { recursive: true })
);

const FONT_MAP = {
  greatvibes: {
    label: 'Great Vibes',
    files: {
      normal: {
        name: 'GreatVibes.ttf',
        url: 'https://github.com/google/fonts/raw/main/ofl/greatvibes/GreatVibes-Regular.ttf',
      },
      bold: { name: 'GreatVibes.ttf', url: null },
      italic: { name: 'GreatVibes.ttf', url: null },
      bolditalic: { name: 'GreatVibes.ttf', url: null },
    },
  },

  cinzel: {
    label: 'Cinzel',
    files: {
      normal: {
        name: 'Cinzel.ttf',
        url: 'https://github.com/google/fonts/raw/main/ofl/cinzel/Cinzel%5Bwght%5D.ttf',
      },
      bold: { name: 'Cinzel.ttf', url: null },
      italic: { name: 'Cinzel.ttf', url: null },
      bolditalic: { name: 'Cinzel.ttf', url: null },
    },
  },

  playfair: {
    label: 'Playfair Display',
    files: {
      normal: {
        name: 'PlayfairDisplay.ttf',
        url: 'https://github.com/google/fonts/raw/main/ofl/playfairdisplay/PlayfairDisplay%5Bwght%5D.ttf',
      },
      bold: { name: 'PlayfairDisplay.ttf', url: null },
      italic: {
        name: 'PlayfairDisplay-Italic.ttf',
        url: 'https://github.com/google/fonts/raw/main/ofl/playfairdisplay/PlayfairDisplay-Italic%5Bwght%5D.ttf',
      },
      bolditalic: { name: 'PlayfairDisplay-Italic.ttf', url: null },
    },
  },
};

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = u => {
      https
        .get(u, res => {
          if ([301, 302, 307, 308].includes(res.statusCode)) {
            return follow(res.headers.location);
          }

          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          }

          const tmp = dest + '.tmp';
          const out = fs.createWriteStream(tmp);

          res.pipe(out);

          out.on('finish', () => {
            out.close();
            fs.renameSync(tmp, dest);
            resolve();
          });

          out.on('error', e => {
            fs.rmSync(tmp, { force: true });
            reject(e);
          });
        })
        .on('error', reject);
    };

    follow(url);
  });
}

async function ensureFonts() {
  const needed = new Map();

  for (const font of Object.values(FONT_MAP)) {
    for (const variant of Object.values(font.files)) {
      if (variant.url && !needed.has(variant.name)) {
        needed.set(variant.name, variant.url);
      }
    }
  }

  for (const [filename, url] of needed) {
    const dest = path.join(FONTS_DIR, filename);

    if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) {
      console.log(`✅ Font OK : ${filename}`);
    } else {
      console.log(`⬇️ Downloading font: ${filename} …`);

      try {
        await downloadFile(url, dest);
        console.log(
          `✅ Downloaded: ${filename} (${(fs.statSync(dest).size / 1024).toFixed(0)} KB)`
        );
      } catch (e) {
        console.warn(`⚠️ Could not download ${filename}: ${e.message}`);
      }
    }
  }
}

function resolveFontFile(fontKey, styleKey) {
  const font = FONT_MAP[fontKey] || FONT_MAP.playfair;
  const variant = font.files[styleKey] || font.files.normal;
  const abs = path.join(FONTS_DIR, variant.name);

  if (fs.existsSync(abs) && fs.statSync(abs).size > 1000) {
    return abs;
  }

  const available = fs.readdirSync(FONTS_DIR).filter(f => f.endsWith('.ttf'));

  if (available.length > 0) {
    console.warn(`⚠️ ${variant.name} not found, using ${available[0]}`);
    return path.join(FONTS_DIR, available[0]);
  }

  return null;
}

function escapeDrawtext(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, '’')
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

function fontPathForFFmpeg(fontFile) {
  return fontFile
    .replace(/\\/g, '/')
    .replace(/^([A-Za-z]):/, '$1\\:');
}

function ffprobeSync(filePath) {
  const out = execSync(
    `"${FFPROBE_PATH}" -v quiet -print_format json -show_streams "${filePath}"`,
    { maxBuffer: 10 * 1024 * 1024 }
  );

  return JSON.parse(out.toString());
}

const app = express();

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use('/outputs', express.static(OUTPUTS_DIR));
app.use('/uploads', express.static(UPLOADS_DIR));

const storage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
});

app.post('/api/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const probe = ffprobeSync(filePath);
    const videoStream = probe.streams.find(s => s.codec_type === 'video');

    if (!videoStream) {
      return res.status(400).json({ error: 'No video stream found' });
    }

    const width = parseInt(videoStream.width);
    const height = parseInt(videoStream.height);

    const thumbName = `thumb_${req.file.filename}.jpg`;
    const thumbPath = path.join(UPLOADS_DIR, thumbName);

    execSync(
      `"${FFMPEG_PATH}" -i "${filePath}" -vframes 1 -q:v 2 "${thumbPath}" -y`
    );

    res.json({
      videoId: req.file.filename,
      videoPath: `/uploads/${req.file.filename}`,
      thumbnailPath: `/uploads/${thumbName}`,
      width,
      height,
    });
  } catch (err) {
    console.error('[upload]', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/generate', async (req, res) => {
  const { videoId, texts = [], duration = 5 } = req.body;

  if (!videoId) {
    return res.status(400).json({ error: 'Missing videoId' });
  }

  if (!Array.isArray(texts) || texts.length === 0) {
    return res.status(400).json({ error: 'Please add at least one text layer' });
  }

  const inputPath = path.join(UPLOADS_DIR, videoId);

  if (!fs.existsSync(inputPath)) {
    return res.status(404).json({ error: 'Video not found' });
  }

  try {
    const probe = ffprobeSync(inputPath);
    const videoStream = probe.streams.find(s => s.codec_type === 'video');

    const vidW = parseInt(videoStream.width);
    const vidH = parseInt(videoStream.height);

    const fd = 0.4;
    const alpha = `if(lt(t,${fd}),t/${fd},if(lt(t,${duration - fd}),1,if(lt(t,${duration}),(${duration}-t)/${fd},0)))`;

    const filters = [];

    for (const item of texts) {
      if (!item.text || item.x === undefined || item.y === undefined) continue;

      const absX = Math.round(Number(item.x) * vidW);
      const absY = Math.round(Number(item.y) * vidH);

      const fontSize = Math.round(Number(item.fontSize || 48));
      const fontColor = item.color || '#ffffff';
      const fontKey = item.fontKey || 'playfair';
      const fontStyle = item.fontStyle || 'normal';

      const fontFile = resolveFontFile(fontKey, fontStyle);

      if (!fontFile) {
        return res.status(500).json({
          error: `No font files found in ${FONTS_DIR}`,
        });
      }

      const safeText = escapeDrawtext(item.text);
      const safeFont = fontPathForFFmpeg(fontFile);
      const ffColor = '0x' + fontColor.replace('#', '');

      filters.push(
        `drawtext=` +
          `fontfile='${safeFont}':` +
          `text='${safeText}':` +
          `fontsize=${fontSize}:` +
          `fontcolor=${ffColor}:` +
          `x='${absX}-(text_w/2)':` +
          `y='${absY}-(text_h/2)':` +
          `alpha='${alpha}':` +
          `enable='between(t,0,${duration})'`
      );
    }

    if (filters.length === 0) {
      return res.status(400).json({ error: 'No valid text layers found' });
    }

    const drawtextFilter = filters.join(',');

    const outputName = `${uuidv4()}.mp4`;
    const outputPath = path.join(OUTPUTS_DIR, outputName);

    console.log('[generate] Text layers:', texts.length);
    console.log('[generate] Video size:', vidW, vidH);

    const ffmpegArgs = [
      '-i',
      inputPath,
      '-vf',
      drawtextFilter,
      '-c:v',
      'libx264',
      '-c:a',
      'copy',
      '-preset',
      'fast',
      '-crf',
      '22',
      '-movflags',
      '+faststart',
      '-y',
      outputPath,
    ];

    await new Promise((resolve, reject) => {
      const ff = spawn(FFMPEG_PATH, ffmpegArgs);
      let stderr = '';

      ff.stderr.on('data', d => {
        stderr += d.toString();
      });

      ff.on('close', code => {
        if (code === 0) {
          resolve();
        } else {
          console.error('[ffmpeg stderr tail]\n', stderr.slice(-3000));
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });
    });

    const firstText = texts[0]?.text || 'guest';
    const slug = firstText.replace(/\s+/g, '_').replace(/[^\w\u0900-\u097F]/g, '');

    res.json({
      outputPath: `/outputs/${outputName}`,
      downloadUrl: `/outputs/${outputName}`,
      filename: `wedding_invite_${slug || 'guest'}.mp4`,
    });
  } catch (err) {
    console.error('[generate error]', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (req, res) => {
  const fontsOnDisk = fs.existsSync(FONTS_DIR)
    ? fs.readdirSync(FONTS_DIR).filter(f => f.endsWith('.ttf'))
    : [];

  res.json({
    ok: true,
    baseDir: BASE_DIR,
    fontsDir: FONTS_DIR,
    fontsOnDisk,
    ffmpeg: FFMPEG_PATH,
    ffprobe: FFPROBE_PATH,
  });
});

setInterval(() => {
  const cutoff = Date.now() - 3_600_000;

  try {
    fs.readdirSync(OUTPUTS_DIR).forEach(f => {
      const fp = path.join(OUTPUTS_DIR, f);

      try {
        if (fs.statSync(fp).mtimeMs < cutoff) {
          fs.rmSync(fp, { force: true });
        }
      } catch {}
    });
  } catch {}
}, 600_000);

const PORT = process.env.PORT || 3001;

ensureFonts()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n🎬 Wedding Invite API → http://localhost:${PORT}`);
      console.log(`Health check → http://localhost:${PORT}/api/health\n`);
    });
  })
  .catch(err => {
    console.error('Startup error:', err);
    process.exit(1);
  });