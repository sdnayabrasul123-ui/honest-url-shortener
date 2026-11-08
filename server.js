const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

app.set("trust proxy", 1);
app.use(express.json());
app.use(express.static(__dirname));

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("Missing Supabase environment variables");
}

const supabaseRequest = async (endpoint, options = {}) => {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error("Supabase configuration missing");
  }

  return fetch(
    `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${endpoint}`,
    {
      ...options,
      headers: {
        apikey: SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
        "Content-Type": "application/json",
        ...options.headers
      }
    }
  );
};

// Shorten URL
app.post("/api/shorten", async (req, res) => {
  try {
    const { url, alias } = req.body || {};

    let parsed;

    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({
        error: "Please enter a valid URL"
      });
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return res.status(400).json({
        error: "Invalid URL"
      });
    }

    const code = alias
      ? String(alias).trim()
      : crypto.randomBytes(4).toString("hex");

    if (!/^[a-zA-Z0-9_-]{3,30}$/.test(code)) {
      return res.status(400).json({
        error: "Invalid alias"
      });
    }

    const response = await supabaseRequest("links", {
      method: "POST",
      headers: {
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        code,
        original_url: parsed.href
      })
    });

    if (response.status === 409) {
      return res.status(409).json({
        error: "Alias already exists"
      });
    }

    if (!response.ok) {
      const error = await response.text();
      console.error("Supabase insert error:", error);

      return res.status(500).json({
        error: "Could not save link"
      });
    }

    res.json({
      shortUrl: `${req.protocol}://${req.get("host")}/${code}`
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Server error"
    });
  }
});

// Redirect short link
app.get("/:code", async (req, res, next) => {
  try {
    const code = req.params.code;

    if (!/^[a-zA-Z0-9_-]{3,30}$/.test(code)) {
      return next();
    }

    const response = await supabaseRequest(
      `rpc/increment_link_clicks`,
      {
        method: "POST",
        body: JSON.stringify({
          link_code: code
        })
      }
    );

    if (!response.ok) {
      console.error(
        "Supabase redirect error:",
        await response.text()
      );

      return res.status(500).send("Redirect service unavailable");
    }

    const originalUrl = await response.json();

    if (!originalUrl) {
      return next();
    }

    res.redirect(302, originalUrl);

  } catch (error) {
    console.error(error);
    res.status(500).send("Server error");
  }
});

// Link statistics
app.get("/api/stats/:code", async (req, res) => {
  try {
    const code = req.params.code;

    const response = await supabaseRequest(
      `links?code=eq.${encodeURIComponent(code)}&select=code,clicks,original_url`
    );

    if (!response.ok) {
      return res.status(500).json({
        error: "Could not fetch statistics"
      });
    }

    const rows = await response.json();

    if (!rows.length) {
      return res.status(404).json({
        error: "Link not found"
      });
    }

    res.json({
      code: rows[0].code,
      clicks: rows[0].clicks,
      originalUrl: rows[0].original_url
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Server error"
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`HONEST running on port ${PORT}`);
});