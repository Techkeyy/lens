/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  async headers() {
    return [
      {
        // The proof page reads a disclosure from the URL fragment. A fragment
        // is never sent to a server, but the surrounding page must not leak the
        // URL onward or sit in a shared cache.
        source: "/proof/:commitment*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
