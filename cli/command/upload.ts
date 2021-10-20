import { Argument, Option, Command } from "commander";
import { getCOSCMDConfig, Client, SingleUploadConfig } from "../../lib/index";
import { isArray } from "lodash";
import { red, green, cyan, blue, gray } from "chalk";

export function install(program: Command) {
  program
    .command("upload")
    .alias("up")
    .addArgument(new Argument("[source]", "要上传的本地资源，支持单文件、文件夹、glob 表达式"))
    .addArgument(new Argument("[target]", "保存到 COS 的路径，默认是根路径"))
    .addOption(new Option("--ignore [ignore...]", "需要忽略的文件的 glob 表达式"))
    .addOption(
      new Option(
        "--rename [rename]",
        "是否对文件进行重命名，如果为是，默认使用 16 个小写字母和数字的随机组合，指定数字可以自定义长度"
      ).argParser((v) => parseInt(v, 10) || 16)
    )
    .addOption(new Option("--flat", "是否展开文件夹层级"))
    .addOption(new Option("--show-progress", "是否以进度条的形式展示上传过程"))
    .addOption(new Option("--cdn-purge-cache", "是否刷新 CDN 缓存"))
    .addOption(new Option("--cdn-push-cache", "是否预热 CDN 缓存"))
    .addOption(new Option("--dry-run", "只模拟上传过程，不实际上传"))
    .description("上传本地文件到腾讯云 COS")
    .action(async (source, target, opts) => {
      try {
        const { client, upload } = await getCOSCMDConfig();
        const clients = client ? (isArray(client) ? client : [client]).filter(({ enable }) => enable) : [];
        if (!clients.length) {
          throw new Error(`缺少 COS 客户端，请先在 "cos.config.js" 文件中新增客户端`);
        }

        let uploads: SingleUploadConfig[] = [];
        if (source) {
          uploads = [{ source, target, ...opts }];
        } else if (!upload) {
          throw new Error(`缺少 upload 配置，你需要设置要上传的本地文件`);
        } else {
          uploads = (isArray(upload) ? upload : [upload]).map((v) => ({ ...v, ...opts }));
        }

        await clients.reduce(async (clientPromise, clientConfig) => {
          await clientPromise;
          const client = new Client(clientConfig);
          await uploads.reduce(async (uploadPromise, uploadConfig) => {
            await uploadPromise;
            const uploadRes = await client.upload(uploadConfig);
            const { files, startTime, endTime } = uploadRes;
            const maxPathLength = Math.max(...files.map(({ rPath }) => rPath.length));
            const totalCount = files.length;
            const successCount = files.filter(({ cosError }) => !cosError).length;
            const failCount = totalCount - successCount;
            const duration = endTime - startTime;
            const oneMinute = 60 * 1000;

            if (uploadConfig.showProgress || uploadConfig.dryRun) {
              console.log(
                files
                  .map(
                    ({ rPath, cosKey, url, cosError }) =>
                      `${rPath} ${gray(`${"-".repeat(maxPathLength - rPath.length + 3)}>`)} ${
                        cosError ? red(cosKey) : green.underline(url)
                      }`
                  )
                  .join("\n")
              );
            }

            console.log(
              blue(
                `${uploadConfig.dryRun ? "模拟" : ""}上传完成 耗时 ${
                  duration < oneMinute
                    ? `${(duration / 1000).toFixed(2)} 秒`
                    : `${Math.floor(duration / oneMinute)} 分 ${Math.round((duration % oneMinute) / 1000)} 秒`
                } 文件总数 ${cyan(totalCount)} 成功 ${green(successCount)} 失败 ${red(failCount)}`
              )
            );
          }, Promise.resolve());
        }, Promise.resolve());
      } catch (error) {
        console.log(red("上传失败"), error);
      }
    });
}
