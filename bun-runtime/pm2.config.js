const isLinux = process.platform === "linux";

module.exports = {
  apps: [
    {
      name: "9router-bun",
      script: "index.ts",
      interpreter: "bun",
      exec_mode: "fork",
      instances: isLinux ? 4 : 1, //"max" spawn one process per CPU core; reusePort handles load balancing
      cwd: __dirname,
      autorestart: true,
      watch: false,
      env: {
        PORT: "20129",
        NODE_ENV: "production",
        PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`,
      },
    },
  ],
};
