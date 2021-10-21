import { Command, Option } from "commander";
import { red } from "chalk";
import { inspect } from "util";
import { isArray } from "lodash";
import { Table } from "console-table-printer";

import { getCOSCMDConfig } from "../../../../lib/index";

export function install(cosProgram: Command, clientProgram: Command) {
  clientProgram
    .command("list", { isDefault: true })
    .addOption(new Option("--detail", "查看详细信息"))
    .description("查看 COS 客户端列表")
    .action(async (opts) => {
      try {
        const { configFile } = cosProgram.opts();
        const { client } = await getCOSCMDConfig(configFile);
        const clients = client ? (isArray(client) ? client : [client]) : [];
        if (!clients.length) {
          console.log(red(`缺少 COS 客户端，请先在 "cos.config.js" 文件中新增客户端`));
          return;
        }

        if (opts.detail) {
          console.log(inspect(clients, { compact: false, colors: true }));
        } else {
          const table = new Table({
            title: "COS 客户端列表",
            columns: [
              { name: "name", alignment: "left" },
              { name: "enable", alignment: "left" },
              { name: "Bucket", alignment: "left" },
              { name: "Region", alignment: "left" },
              { name: "CDN", alignment: "left" },
            ],
          });
          table.addRows(
            clients.map((client) => ({
              name: client.name,
              enable: !!client.enable,
              Bucket: client.Bucket,
              Region: client.Region,
              CDN: client.cdn?.domain,
            })),
            { color: "crimson" }
          );
          table.printTable();
        }
      } catch (error) {
        console.log(red("查看 COS 客户端列表失败"), error);
      }
    });
}
