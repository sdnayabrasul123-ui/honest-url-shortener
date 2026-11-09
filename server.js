
const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

app.set("trust proxy", 1);
app.use(express.json({ limit: "20kb" }));
app.use(express.static(__dirname));

const baseUrl = (SUPABASE_URL || "").replace(/\/$/, "");

// Validate configuration
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SECRET_KEY) {
  console.error("Missing Supabase environment variables");
}

// Supabase database request (server-side secret key only)
async function supabaseRequest(endpoint, options = {}) {
  if (!baseUrl || !SUPABASE_SECRET_KEY) {
    throw new Error("Supabase configuration missing");
  }

  return fetch(`${baseUrl}/rest/v1/${endpoint}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...options.headers
    }
  });
}

// Verify logged-in Supabase user
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ")
      ? header.slice(7)
      : "";

    if (!token) {
      return res.status(401).json({
        error: "Please log in first"
      });
    }

    const response = await fetch(`${baseUrl}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      return res.status(401).json({
        error: "Invalid or expired login. Please log in again."
      });
    }

    const user = await response.json();

    if (!user || !user.id) {
      return res.status(401).json({
        error: "User authentication failed"
      });
    }

    req.user = user;
    next();

  } catch (error) {
    console.error("Authentication error:", error);
    res.status(500).json({
      error: "Authentication service unavailable"
    });
  }
}

// Check login
app.get("/api/me", requireAuth, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email
  });
});

// Get personal link history
app.get("/api/links", requireAuth, async (req, res) => {
  try {
    const query =
      "links?user_id=eq." +
      encodeURIComponent(req.user.id) +
      "&select=code,original_url,clicks&limit=100";

    const response = await supabaseRequest(query);

    if (!response.ok) {
      console.error(await response.text());
      return res.status(500).json({
        error: "Could not load link history"
      });
    }

    const rows = await response.json();

    res.json(rows.map(row => ({
      code: row.code,
      originalUrl: row.original_url,
      clicks: row.clicks,
      shortUrl: `${req.protocol}://${req.get("host")}/${row.code}`
    })));

  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Server error"
    });
  }
});

// Create short link (login required)
app.post("/api/shorten", requireAuth, async (req, res) => {
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
        error: "Invalid alias. Use 3-30 letters or numbers."
      });
    }

    const response = await supabaseRequest("links", {
      method: "POST",
      headers: {
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        code,
        original_url: parsed.href,
        user_id: req.user.id
      })
    });

    if (response.status === 409) {
      return res.status(409).json({
        error: "This alias already exists"
      });
    }

    if (!response.ok) {
      console.error("Insert error:", await response.text());

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

// Personal link statistics
app.get("/api/stats/:code", requireAuth, async (req, res) => {
  try {
    const query =
      "links?code=eq." +
      encodeURIComponent(req.params.code) +
      "&user_id=eq." +
      encodeURIComponent(req.user.id) +
      "&select=code,clicks,original_url";

    const response = await supabaseRequest(query);

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

// Public short-link redirect
app.get("/:code", async (req, res, next) => {
  try {
    const code = req.params.code;

    if (!/^[a-zA-Z0-9_-]{3,30}$/.test(code)) {
      return next();
    }

    const response = await supabaseRequest(
      "rpc/increment_link_clicks",
      {
        method: "POST",
        body: JSON.stringify({
          link_code: code
        })
      }
    );

    if (!response.ok) {
      console.error(await response.text());
      return res.status(500).send("Redirect service unavailable");
    }

    const originalUrl = await response.json();

    if (
      typeof originalUrl !== "string" ||
      !["http:", "https:"].includes(new URL(originalUrl).protocol)
    ) {
      return next();
    }

    res.redirect(302, originalUrl);

  } catch (error) {
    console.error(error);
    res.status(500).send("Server error");
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`HONEST running on port ${PORT}`);
});
