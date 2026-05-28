const express = require('express');
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
const OUTPUTS_DIR = path.join(BASE_DIR, 'outputs');
const FONTS_DIR = path.join(BASE_DIR, 'fonts');
const TEMPLATE_DIR = path.join(BASE_DIR, 'template');

const TEMPLATE_PATH = path.join(TEMPLATE_DIR, 'template.mp4');
const INTRO_PATH = path.join(TEMPLATE_DIR, 'intro.mp4');
const REST_PATH = path.join(TEMPLATE_DIR, 'rest.mp4');

[OUTPUTS_DIR, FONTS_DIR, TEMPLATE_DIR].forEach(d =>
  fs.mkdirSync(d, { recursive: true })
);

console.log('📁 BASE_DIR:', BASE_DIR);
console.log('📁 INTRO:', INTRO_PATH);
console.log('📁 REST:', REST_PATH);

const FONT_MAP = {
  greatvibes: {
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
      console.log(`✅ Font OK: ${filename}`);
    } else {
      console.log(`⬇️ Downloading font: ${filename}`);

      try {
        await downloadFile(url, dest);
        console.log(`✅ Downloaded: ${filename}`);
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
  return fontFile.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
}

function ffprobeSync(filePath) {
  const out = execSync(
    `"${FFPROBE_PATH}" -v quiet -print_format json -show_streams "${filePath}"`,
    { maxBuffer: 20 * 1024 * 1024 }
  );

  return JSON.parse(out.toString());
}

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const ff = spawn(FFMPEG_PATH, args);
    let stderr = '';

    ff.stderr.on('data', d => {
      stderr += d.toString();
    });

    ff.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        console.error('[FFmpeg error]\n', stderr.slice(-5000));
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });
  });
}

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/outputs', express.static(OUTPUTS_DIR));
app.use('/template', express.static(TEMPLATE_DIR));

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    ffmpeg: FFMPEG_PATH,
    ffprobe: FFPROBE_PATH,
    templateExists: fs.existsSync(TEMPLATE_PATH),
    introExists: fs.existsSync(INTRO_PATH),
    restExists: fs.existsSync(REST_PATH),
  });
});

app.get('/api/template', (req, res) => {
  try {
    if (!fs.existsSync(INTRO_PATH)) {
      return res.status(404).json({
        error: 'intro.mp4 not found. Put it at backend/template/intro.mp4',
      });
    }

    const probe = ffprobeSync(INTRO_PATH);
    const vs = probe.streams.find(s => s.codec_type === 'video');

    if (!vs) {
      return res.status(400).json({
        error: 'No video stream found in intro.mp4',
      });
    }

    const width = parseInt(vs.width);
    const height = parseInt(vs.height);

    const thumbName = 'template-thumb.jpg';
    const thumbPath = path.join(TEMPLATE_DIR, thumbName);

    if (!fs.existsSync(thumbPath)) {
      execSync(
        `"${FFMPEG_PATH}" -i "${INTRO_PATH}" -vframes 1 -q:v 2 "${thumbPath}" -y`
      );
    }

    res.json({
      width,
      height,
      thumbnailPath: `/template/${thumbName}`,
    });
  } catch (err) {
    console.error('[template]', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/generate', async (req, res) => {
  const { texts = [], duration = 5 } = req.body;

  if (!fs.existsSync(INTRO_PATH)) {
    return res.status(404).json({
      error: 'intro.mp4 not found. Put it at backend/template/intro.mp4',
    });
  }

  if (!fs.existsSync(REST_PATH)) {
    return res.status(404).json({
      error: 'rest.mp4 not found. Put it at backend/template/rest.mp4',
    });
  }

  if (!Array.isArray(texts) || texts.length === 0) {
    return res.status(400).json({
      error: 'Please add at least one text layer',
    });
  }

  try {
    const probe = ffprobeSync(INTRO_PATH);
    const vs = probe.streams.find(s => s.codec_type === 'video');

    const vidW = parseInt(vs.width);
    const vidH = parseInt(vs.height);

    const fd = 0.35;
    const alpha = `if(lt(t,${fd}),t/${fd},if(lt(t,${duration - fd}),1,if(lt(t,${duration}),(${duration}-t)/${fd},0)))`;

    const filters = [];

    for (const item of texts) {
      if (!item.text) continue;

      const absX = Math.round(Number(item.x) * vidW);
      const absY = Math.round(Number(item.y) * vidH);

      const fontSize = Math.round(Number(item.fontSize || 48));
      const fontColor = '#3d1611';
      const fontKey = item.fontKey || 'playfair';
      const fontStyle = item.fontStyle || 'normal';

      const fontFile = resolveFontFile(fontKey, fontStyle);

      if (!fontFile) {
        return res.status(500).json({
          error: 'No font file found',
        });
      }

      const safeFont = fontPathForFFmpeg(fontFile);
      const safeText = escapeDrawtext(item.text);
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

    if (!filters.length) {
      return res.status(400).json({
        error: 'No valid text layers found',
      });
    }

    const drawtextFilter = filters.join(',');

    const outputName = `${uuidv4()}.mp4`;
    const outputPath = path.join(OUTPUTS_DIR, outputName);

    const renderedIntro = path.join(OUTPUTS_DIR, `intro_rendered_${uuidv4()}.mp4`);
    const listFile = path.join(OUTPUTS_DIR, `concat_${uuidv4()}.txt`);

    try {
      console.log('[generate] Rendering only intro.mp4');

      await runFFmpeg([
        '-i',
        INTRO_PATH,
        '-vf',
        drawtextFilter,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '18',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        '-y',
        renderedIntro,
      ]);

      fs.writeFileSync(
        listFile,
        `file '${renderedIntro.replace(/\\/g, '/')}'\nfile '${REST_PATH.replace(/\\/g, '/')}'\n`
      );

      console.log('[generate] Joining rendered intro + rest.mp4');

      await runFFmpeg([
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listFile,
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        '-y',
        outputPath,
      ]);
    } finally {
      fs.rmSync(renderedIntro, { force: true });
      fs.rmSync(listFile, { force: true });
    }

    const firstText = texts[0]?.text || 'guest';
    const slug = firstText
      .replace(/\s+/g, '_')
      .replace(/[^\w\u0900-\u097F]/g, '');

    res.json({
      outputPath: `/outputs/${outputName}`,
      downloadUrl: `/outputs/${outputName}`,
      filename: `wedding_invite_${slug || 'guest'}.mp4`,
    });
  } catch (err) {
    console.error('[generate]', err);
    res.status(500).json({
      error: err.message,
    });
  }
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


ensureFonts().then(() => {
  const { execSync } = require('child_process');

try {
  execSync(
    `"${FFMPEG_PATH}" -i "${TEMPLATE_PATH}" -t 5 -c copy "${path.join(TEMPLATE_DIR, 'intro.mp4')}" -y`
  );

  execSync(
    `"${FFMPEG_PATH}" -i "${TEMPLATE_PATH}" -ss 5 -c copy "${path.join(TEMPLATE_DIR, 'rest.mp4')}" -y`
  );

  console.log('✅ intro.mp4 and rest.mp4 created');
} catch (e) {
  console.error(e);
}
  app.listen(PORT, () => {
    console.log(`\n🎬 Wedding Invite API running on http://localhost:${PORT}`);
    console.log(`Intro must be here: ${INTRO_PATH}`);
    console.log(`Rest must be here : ${REST_PATH}\n`);
  });
});
