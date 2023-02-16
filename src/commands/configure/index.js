const program = require("commander");
const configUtil = require("./configure");
program
  .command("configure")
  .alias("c")
  .option("--github-token <github-token>", "GitHub token")
  .description("Adds cofiguration parameters to the CLI")
  .action(async (cmd) => {
    await configUtil.run(cmd);
  });
