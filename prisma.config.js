module.exports = {
  datasources: {
    db: {
      url: {
        fromEnvVar: "DATABASE_URL",
        value: "file:dev.sqlite",
      },
    },
  },
};
