import { Command } from "commander";

export async function install(cosProgram: Command) {
  const clientProgram = new Command("client").description("管理 COS 客户端");
  await import("./command/list").then(({ install }) => install(cosProgram, clientProgram));
  cosProgram.addCommand(clientProgram);
}
