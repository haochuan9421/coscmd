import { Command } from "commander";

export async function install(program: Command) {
  const clientProgram = new Command("client").description("管理 COS 客户端");
  await import("./command/list").then(({ install }) => install(clientProgram));
  program.addCommand(clientProgram);
}
