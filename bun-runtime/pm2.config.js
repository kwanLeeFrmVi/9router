module.exports = {
  apps: [
    {
      name: "9router-bun",
      script: "index.ts",
      interpreter: "bun",
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
