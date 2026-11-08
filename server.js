
const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const links = new Map();

app.set("trust proxy", 1);
app.use(express.json());
app.use(express.static(__dirname));

app.post("/api/shorten", (req, res) => {
  const { url, alias } = req.body;

  try {
    const parsed = new URL(url);

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return res.status(400).json({ error: "Invalid URL" });
    }

    const code = alias || crypto.randomBytes(4).toString("hex");

    if (!/^[a-zA-Z0-9_-]{3,30}$/.test(code)) {
      return res.status(400).json({ error: "Invalid alias" });
    }

    if (links.has(code)) {
      return res.status(409).json({ error: "Alias already exists" });
    }

    links.set(code, { url: parsed.href, clicks: 0 });

    res.json({
      shortUrl: `${req.protocol}://${req.get("host")}/${code}`
    });
  } catch {
    res.status(400).json({ error: "Please enter a valid URL" });
  }
});

app.get("/:code", (req, res, next) => {
  const item = links.get(req.params.code);

  if (!item) return next();

  item.clicks++;
  res.redirect(item.url);
});

app.get("/api/stats/:code", (req, res) => {
  const item = links.get(req.params.code);

  if (!item) {
    return res.status(404).json({ error: "Link not found" });
  }

  res.json({ clicks: item.clicks });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`HONEST running on port ${PORT}`);
});
