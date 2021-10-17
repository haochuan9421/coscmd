const fs = require("fs");
const path = require("path");

const toogle = process.argv[2];
if (toogle) {
  // 读取 package.json 的内容
  const pkgFile = path.join(path.dirname(process.argv[1]), "package.json");
  const pkgBuffer = fs.readFileSync(pkgFile);
  const pkgContent = pkgBuffer.toString("utf8");
  const pkg = JSON.parse(pkgContent);
  // 获取 package.json 的缩进大小
  const match = /^[ ]+|\t+/m.exec(pkgContent);
  const indent = match ? match[0] : null;
  if (toogle === "--remove") {
    pkg.scripts._postinstall = pkg.scripts._postinstall || pkg.scripts.postinstall;
    delete pkg.scripts.postinstall;
  } else if (toogle === "--restore") {
    pkg.scripts.postinstall = pkg.scripts._postinstall || pkg.scripts.postinstall;
    delete pkg.scripts._postinstall;
  }
  // 获取 package.json 的 EOL
  const POSIX_EOL = "\n";
  const WINDOWS_EOL = "\r\n";
  const lf = POSIX_EOL.charCodeAt(0);
  const cr = WINDOWS_EOL.charCodeAt(0);
  let eol;
  for (let i = 0; i < pkgBuffer.length; ++i) {
    if (pkgBuffer[i] === lf) {
      eol = POSIX_EOL;
      break;
    }
    if (pkgBuffer[i] === cr) {
      eol = WINDOWS_EOL;
      break;
    }
  }
  // 更新 package.json 文件
  const newPkgContent = JSON.stringify(pkg, null, indent).replace(/\n/g, eol);
  fs.writeFileSync(pkgFile, newPkgContent);
}
