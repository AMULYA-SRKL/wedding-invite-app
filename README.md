# 💍 Wedding Invite Video Personalizer

Add each guest's name to your wedding invitation video — precisely, beautifully.

---

## Project Structure

```
wedding-invite-app/
├── backend/
│   ├── server.js        ← Express + FFmpeg API
│   ├── package.json
│   ├── uploads/         ← Uploaded video + thumbnails (auto-created)
│   └── outputs/         ← Generated personalised videos (auto-created)
└── frontend/
    └── index.html       ← Full single-file frontend (open in browser)
```

---

## Prerequisites

| Tool    | Version | Install |
|---------|---------|---------|
| Node.js | ≥ 18    | https://nodejs.org |
| FFmpeg  | any     | `sudo apt install ffmpeg` · `brew install ffmpeg` · https://ffmpeg.org |

### Check:
```bash
node --version     # v18+
ffmpeg -version    # any recent build
```

---

## Setup & Run

### 1. Install backend dependencies
```bash
cd wedding-invite-app/backend
npm install
```

### 2. Start the backend server
```bash
node server.js
# ✅ Wedding Invite API running on http://localhost:3001
```

### 3. Open the frontend
Just open `frontend/index.html` in any modern browser — no build step needed.

> On macOS: `open frontend/index.html`  
> On Linux: `xdg-open frontend/index.html`  
> On Windows: double-click `frontend/index.html`

---

## App Flow

1. **Configure** — Enter backend URL (default: `http://localhost:3001`), click Test
2. **Upload** — Select your standard wedding invite video (MP4/MOV/AVI up to 500 MB)
3. **Position** — Click anywhere on the first-frame preview to place the name
4. **Customize** — Enter guest name, adjust font size/style/color, fine-tune X/Y position
5. **Generate** — Hit the button; FFmpeg renders the video server-side in ~20–60 seconds
6. **Share** — Download or share directly to WhatsApp

---

## How Coordinate Matching Works

This is the most important part — ensuring the text appears in *exactly* the same position
in the preview and the final rendered video.

### Preview → Video coordinate mapping:

```
click position (px)
  ÷ rendered image size (px)   ← the <img> element's actual displayed size
  = normalised position (0–1)  ← stored in state.posX / state.posY
  × video natural resolution   ← done server-side by FFmpeg drawtext
  = FFmpeg x/y (pixels)
```

**Why normalised floats?**  
The preview `<img>` is CSS-scaled to fit the container and will have a different pixel size
than the video. By converting to 0–1 fractions before sending to the server, the mapping is
resolution-independent.

**Font size scaling:**  
The frontend scales the preview marker's font size by `img.offsetWidth / video.naturalWidth`
so the text looks proportionally identical in the preview. The server receives the *absolute*
pixel font size and passes it directly to FFmpeg.

---

## WhatsApp Sharing — How It Works

### Mobile (Android / iOS) — Web Share API
```
navigator.share({ files: [videoBlob] })
```
- The browser opens the native share sheet
- The user taps WhatsApp → video is sent directly as a file
- Works in Chrome for Android, Safari on iOS (iOS 15+)
- **Best experience** — one tap, no download needed

### Mobile — Fallback (no Web Share API)
```
whatsapp://send?text=...
```
- Opens the WhatsApp app with a pre-filled message containing the video URL
- The recipient can download the video from the URL
- Only works if the video is publicly accessible (local URLs won't work remotely)

### Desktop
WhatsApp does not support direct file sharing from browser to desktop app.  
The UI instructs the user to:
1. Download the video (Download button)
2. Open WhatsApp Web (https://web.whatsapp.com) or WhatsApp Desktop
3. Open the guest's chat → click attachment icon 📎 → select the video

**For production:** Host the generated videos on a public URL (S3, Cloudinary, etc.)
so you can share a download link via WhatsApp message on desktop.

---

## Environment Variables

```bash
PORT=3001            # Default port for the API server
```

---

## Production Tips

- **Storage:** Move `uploads/` and `outputs/` to S3 or similar for multi-session use
- **Public URLs:** Host outputs publicly so WhatsApp links work cross-device
- **Font quality:** Install `fonts-urw-base35` or copy a `.ttf` into `backend/fonts/` and
  reference it in the `drawtext` filter with `fontfile=` for custom fonts
- **Cleanup:** The server auto-deletes output files older than 1 hour
- **HTTPS:** Required for Web Share API — use nginx + Let's Encrypt in production
- **CORS:** Restrict `app.use(cors())` to your frontend domain in production

---

## Custom Fonts

To use a custom font (e.g. a beautiful serif for weddings):

1. Place the `.ttf` file in `backend/fonts/MyFont.ttf`
2. In `server.js`, replace the `font=` parameter in the `drawtextFilter` with:
   ```js
   `:fontfile='${__dirname}/fonts/MyFont.ttf'`
   ```

Popular wedding fonts: *Great Vibes*, *Cinzel*, *Cormorant Garamond*, *Playfair Display*
(download from Google Fonts as `.ttf`)
