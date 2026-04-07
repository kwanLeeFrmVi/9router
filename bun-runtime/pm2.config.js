const isLinux = process.platform === "linux";

module.exports = {
  apps: [
    {
      name: "9router-bun",
      script: "index.ts",
      interpreter: "bun",
      exec_mode: "fork",
      instances: isLinux ? 4 : 1,
      cwd: __dirname,
      autorestart: true,
      watch: false,
      env: {
        PORT: "20129",
        NODE_ENV: "production",
        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`,
      },
    },
    {
      name: "9router-dashboard",
      script: "node_modules/.bin/vite",
      args: "preview --port 20130",
      cwd: `${__dirname}/dashboard`,
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      env: {
        NODE_ENV: "production",
        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`,
      },
    },
  ],
};