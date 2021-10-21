#!/usr/bin/env node

import chalk from "chalk";
import { Command, Option } from "commander";
import updateNotifier from "update-notifier";
import pkg from "../package.json";

// 检测 npm 版本，提示用户更新
updateNotifier({
  pkg,
  updateCheckInterval: 24 * 60 * 60 * 1000, // 每天
}).notify({ isGlobal: true });

(async () => {
  const cosProgram = new Command("cos");
  cosProgram.version(pkg.version, "-v, --version");

  cosProgram.addOption(new Option("--config-file [configFile]", "指定配置文件"));
  cosProgram.addOption(new Option("-c, --client [client]", "指定要使用的 Client 的名称"));

  await import("./command/client").then(({ install }) => install(cosProgram));
  await import("./command/upload").then(({ install }) => install(cosProgram));

  cosProgram.addHelpText(
    "after",
    `\n${chalk.blue(`learn more: ${chalk.underline("https://github.com/HaoChuan9421/coscmd")}`)}`
  );
  cosProgram.parse(process.argv);
})();
