# coscmd

> 一个上传本地文件到[腾讯云对象存储（COS）](https://cloud.tencent.com/product/cos)的命令行工具

<p align="center">
    <a href="https://www.npmjs.com/package/coscmd" target="_blank"><img src="https://img.shields.io/npm/v/coscmd.svg?style=flat-square" alt="Version"></a>
    <a href="https://npmcharts.com/compare/coscmd?minimal=true" target="_blank"><img src="https://img.shields.io/npm/dm/coscmd.svg?style=flat-square" alt="Downloads"></a>
    <a href="https://github.com/HaoChuan9421/coscmd" target="_blank"><img src="https://visitor-badge.glitch.me/badge?page_id=haochuan9421.coscmd"></a>
    <a href="https://github.com/HaoChuan9421/coscmd/commits/master" target="_blank"><img src="https://img.shields.io/github/last-commit/haochuan9421/coscmd.svg?style=flat-square" alt="Commit"></a>
    <a href="https://github.com/HaoChuan9421/coscmd/issues" target="_blank"><img src="https://img.shields.io/github/issues-closed/haochuan9421/coscmd.svg?style=flat-square" alt="Issues"></a>
    <a href="https://github.com/HaoChuan9421/coscmd/blob/master/LICENSE" target="_blank"><img src="https://img.shields.io/npm/l/coscmd.svg?style=flat-square" alt="License"></a>
</p>

## 使用场景

- 希望通过一行简单的命令上传本地文件（夹）到 COS
- 希望前端项目打包完成后自动把产物上传到 COS（参考下面的最佳实践部分）
- 希望文件上传完成后自动预热或刷新 CDN 缓存（需使用[腾讯云 CDN](https://cloud.tencent.com/product/cdn) 并和 COS 绑定）
- 一次上传到多个 COS 存储桶

## 环境要求

Node.js v12 及以上版本。

## 安装

```bash
npm i -g coscmd
# 或
yarn global add coscmd
```

> 安装太慢？试试 [URM](https://github.com/HaoChuan9421/urm)

安装完成后，会获得可全局执行的 `coscmd` 和 `cos` （简写）命令。

## 快速入手

> 执行 `cos upload` 命令前，你需要至少在腾讯云[创建了一个 COS 存储桶](https://cloud.tencent.com/document/product/436/38484)，并把相关的配置添加到了 `coscmd` 的配置文件中。

```bash
# 查看 coscmd 中配置的 COS 客户端
cos client list
# 上传本地 index.js 文件到 COS 的 file/index.js 位置
cos upload index.js file/index.js
# 上传本地 dist 文件夹下的全部文件到 COS 的 project/foo 路径下（up 是 upload 的别名）
cos up dist project/foo
# 上传本地 dist 文件夹下的全部 html、js、css 文件到 COS 的 project/foo 路径下
cos up 'dist/**/*.@(html|js|css)' project/foo
# 上传本地 dist 文件夹下的全部非 map 文件到 COS 的 project/foo 路径下
cos up dist project/foo --ignore 'dist/**/*.map'
```

## 配置介绍

`coscmd` 会从命令行参数、当前目录下的 `cos.config.js` 文件以及用户根目录下的 `cos.config.js` 文件中解析运行时所需的配置，从而决定如何上传文件。一个典型的 `cos.config.js` 配置文件如下：

```js
// cos.config.js
module.exports = {
  client: {
    enable: true, // 是否启用
    Bucket: "bucket-xxxx", // COS 存储桶的名称
    Region: "ap-guangzhou", // COS 存储桶所在地域
    SecretId: "***", // 腾讯云 SecretId
    SecretKey: "***", // 腾讯云 SecretKey
    cdn: { domain: "file.example.com" }, // 与 COS 关联的 CDN 的配置（未关联可不填）
  },
  upload: {
    source: "dist/**", // 本地资源，支持单文件、文件夹、glob 表达式
    ignore: ["dist/**/*.map"], // 要忽略文件的 glob 表达式
    cwd: process.cwd(), // 查找 source 时的工作目录，默认是 process.cwd()
    target: "project/foo", // 保存到 COS 的路径，默认是根路径
    rename: false, // 是否对文件进行重命名，如何设置为 true 默认重命名为 16 个小写字母和数字的随机组合，设置为数字可以自定义长度
    flat: false, // 是否铺平文件夹层级
    showProgress: false, // 是否以进度条的形式展示上传过程
    cdnPurgeCache: false, // 是否刷新 CDN 缓存
    cdnPushCache: false, // 是否预热 CDN 缓存
    dryRun: false, // 只模拟上传过程，不实际上传
  },
};
```

> 你可以复制这段配置，在自己电脑的用户根目录下创建一个 `cos.config.js` 文件，来测试一下上面介绍到的 `cos upload` 命令了，注意把其中的一些值替换为你自己 COS 的配置。

`client` 字段的作用是配置 `COS` 客户端及其关联的 `CDN`，`upload` 字段的作用是配置上传行为。这两个字段可以是一个对象也可以是一个数组，如果是数组，则代表有多个客户端或者有多次不同的上传任务。接下来我们分别详细介绍这两部分的配置。

### 客户端（`client`）配置

`client` 字段的完整 TS 类型定义为如下的 `ClientConfig`：

```ts
import { COSOptions } from "cos-nodejs-sdk-v5";
import { ClientConfig as CDNClientConfig } from "tencentcloud-sdk-nodejs/tencentcloud/common/interface";

// COS 存储桶配置
export interface BucketParams {
  Bucket: string;
  Region: string;
}
export interface SingleClientConfig extends BucketParams, COSOptions {
  // 是否启用这个客户端
  enable?: boolean;
  // client 名称，当有多个客户端时可以在执行命令行时通过 --client 参数指定要使用的客户端，不指定，使用全部 enable 的客户端
  name?: string;
  // COS 关联的 CDN 的相关配置
  cdn?: {
    domain: string; // CDN 加速域名
    config?: CDNClientConfig; // 实例化 CDN Client 时的配置参数
  };
}
export type ClientConfig = SingleClientConfig | SingleClientConfig[];
```

其中 [COSOptions](https://github.com/tencentyun/cos-nodejs-sdk-v5/blob/307b5dbc76a54effffa478674c7f01e3ed1e7460/index.d.ts#L118) 是[腾讯云 COS Node.js SDK](https://github.com/tencentyun/cos-nodejs-sdk-v5) 在实例化 `COS` 客户端时的参数，其中 [CDNClientConfig](https://github.com/TencentCloud/tencentcloud-sdk-nodejs/blob/0f5e03e50972adeaa30b618e2086f15332948ec4/tencentcloud/common/interface.d.ts#L4) 是 [腾讯云 API Node.js SDK](https://github.com/TencentCloud/tencentcloud-sdk-nodejs) 在实例化 `CDN` 客户端时的参数，`cdn.config` 如果未指定，默认会复用 `COSOptions` 中的 `SecretId` 和 `SecretKey`，请保证该密钥同时有 `COS` 和 `CDN` 的访问权限。

当前目录下的配置文件优先级高于用户根目录下的配置文件，所以你可以把 `client` 配置仅保存到用户根目录下的配置文件中，这样可以避免密钥等敏感信息出现在项目代码里。

得益于配置文件是 `js`，你也可以使用环境变量，比如：

```js
// cos.config.js
module.exports = {
  client: [
    {
      /*...*/
      SecretId: process.env.COS_SECRET_ID, // 腾讯云 SecretId
      SecretKey: process.env.COS_SECRET_KEY, // 腾讯云 SecretKey
    },
  ],
  upload: [
    /*...*/
  ],
};
```

你甚至可以通过 Promise 异步返回配置：

```js
// cos.config.js
module.exports = async () => {
  await new Promise((resolve) => setTimeout(resolve, 3000));

  return {
    client: [
      /*...*/
    ],
    upload: [
      /*...*/
    ],
  };
};
```

由于 `COS` 本身也支持使用临时密钥来初始化，你也可以这样设置

```js
// cos.config.js
const axios = require("axios");

module.exports = {
  client: [
    {
      /*...*/
      // 使用临时密钥初始化 COS，参考 https://cloud.tencent.com/document/product/436/14048
      getAuthorization: function (options, callback) {
        axios({
          method: "POST",
          url: "https://example.com/api/cos/sts", // 伪地址，仅作示例
          data: {
            scope: options.Scope,
          },
        }).then((res) => {
          const data = get(res, "data");
          const credentials = get(data, "credentials");

          if (credentials) {
            callback({
              TmpSecretId: credentials.tmpSecretId,
              TmpSecretKey: credentials.tmpSecretKey,
              SecurityToken: credentials.sessionToken,
              StartTime: data.startTime,
              ExpiredTime: data.expiredTime,
              ScopeLimit: true,
            });
          } else {
            console.error("cos credentials invalid");
          }
        });
      },
    },
  ],
  upload: [
    /* ... */
  ],
};
```

### 上传（`upload`）配置

`upload` 字段的完整 TS 类型定义为如下的 `UploadConfig`：

```ts
import {
  PushUrlsCacheRequest,
  PurgeUrlsCacheRequest,
} from "tencentcloud-sdk-nodejs/tencentcloud/services/cdn/v20180606/cdn_models";

export interface SingleUploadConfig {
  source: string; // 本地资源，支持单文件、文件夹、glob 表达式
  ignore: string[]; // 要忽略文件的 glob 表达式
  cwd?: string; // 查找 source 时的工作目录，默认是 process.cwd()
  target?: string; // 保存到 COS 的路径，默认是根路径
  rename?: boolean | number; // 是否对文件进行重命名，如何设置为 true 默认重命名为 16 个小写字母和数字的随机组合，设置为数字可以自定义长度
  flat?: boolean; // 是否铺平文件夹层级
  showProgress?: boolean; // 是否以进度条的形式展示上传过程
  cdnPurgeCache?: boolean | Omit<PurgeUrlsCacheRequest, "Urls">; // 是否刷新 CDN 缓存
  cdnPushCache?: boolean | Omit<PushUrlsCacheRequest, "Urls">; // 是否预热 CDN 缓存
  dryRun?: boolean; // 只模拟上传过程，不实际上传
  preUpload?: (files: Pick<FileRes, "rPath" | "fullPath" | "cosKey">[]) => Promise<void>; // 开始上传前的钩子
  postUpload?: (uploadRes: UploadRes) => Promise<void>; // 上传完成后的钩子
}
export type UploadConfig = SingleUploadConfig | SingleUploadConfig[];
```

其中 [PurgeUrlsCacheRequest](https://github.com/TencentCloud/tencentcloud-sdk-nodejs/blob/0f5e03e50972adeaa30b618e2086f15332948ec4/tencentcloud/services/cdn/v20180606/cdn_models.d.ts#L4783) 和 [PushUrlsCacheRequest](https://github.com/TencentCloud/tencentcloud-sdk-nodejs/blob/0f5e03e50972adeaa30b618e2086f15332948ec4/tencentcloud/services/cdn/v20180606/cdn_models.d.ts#L4783) 分别是 [腾讯云 API Node.js SDK](https://github.com/TencentCloud/tencentcloud-sdk-nodejs) 在调用 CDN 缓存刷新和 CDN 缓存预热 API 时的参数，其中的 `Urls` 字段由 `coscmd` 根据上传的文件自动设置。

`upload` 字段和 `client` 字段一样，当前目录下的配置文件优先级高于用户根目录下的配置文件，所以你可以把 `upload` 配置在项目里，这样就可以为不同的项目设置不同的上传任务了。

`upload` 字段和 `client` 字段不同的地方在于，`upload` 中的值也可以通过命令行参数指定。使用方式如下：

```
Usage: cos upload|up [options] [source] [target]

上传本地文件到腾讯云 COS

Arguments:
  source             要上传的本地资源，支持单文件、文件夹、glob 表达式
  target             保存到 COS 的路径，默认是根路径

Options:
  --rename [rename]  是否对文件进行重命名，如果为是，默认使用 16 个小写字母和数字的随机组合，指定数字可以自定义长度
  --flat             是否展开文件夹层级
  --show-progress    是否以进度条的形式展示上传过程
  --cdn-purge-cache  是否刷新 CDN 缓存
  --cdn-push-cache   是否预热 CDN 缓存
  --dry-run          只模拟上传过程，不实际上传
  -h, --help         display help for command
```

支持多种配置方式的好处在于，你可以把可能包含敏感信息的 `client` 配置保存在用户根目录下，把和上传任务相关的配置保存在项目里或者在运行时指定。这样既方便给不同的项目设置不同的上传任务，也使得你可以在任意位置通过 `cos up` 命令上传任意文件到 `COS` 了。

### `upload` 配置的优先级规则

命令行参数中指定的值会覆盖掉配置文件中的 `upload` 配置。比如配置文件中设置是 `rename: false`，但是执行的命令是 `cos up --renmae`，实际上传时文件依然会重命名。

需要注意的是：如果通过命令行指定了 `source`，那么配置文件中的 `upload` 就会被忽略。比如 `cos up logo.png` 就会把本地的 `logo.png` 上传到 COS 的根目录下，无论当前项目或用户根目录下配置文件中的 `upload` 是什么。

### `source` 与 `target` 介绍

`source` 支持填写单文件路径、文件夹路径、`glob` 表达式，解析 glob 表达式依赖的是 [glob](https://github.com/isaacs/node-glob)，其中 `dot 和 nodir` 参数为 `true`，注意使用 `glob` 表达式时，需要加引号。

`target` 在上传单文件时，如果后缀和 `source` 相同，则作为文件名，比如 `cos up logo.png foo/brand.png` 上传后在 COS 中的位置为 `foo/brand.png`。如果后缀不同或者没有后缀，则作为文件夹，比如 `cos up logo.png bar/brand` 上传后在 COS 中的位置为 `bar/brand/logo.png`。

当 `target` 为文件夹或 glob 表达式时，参考下图中的说明：

![image](https://cdn.zhenghaochuan.com/file/adxjfbo84236abj7.png)

## 最佳实践

#### 一、前端项目打包完成后自动上传产物到 COS 并自动预热 CDN 缓存。

1. 首先在项目中安装 `coscmd`：`npm i coscmd --save-dev` 或 `yarn add coscmd -D`。
2. 在项目中添加 `coscmd` 的运行时配置文件 `cos.config.js`
3. 按照前面介绍配置 `client` 的方式，选择一种安全的方式添加客户端，比如：

```js
const pkg = require("./package.json");

module.exports = {
  client: [
    {
      enable: true,
      Bucket: "bucket-xxxx",
      Region: "ap-guangzhou",
      SecretId: process.env.COS_SECRET_ID, // 从环境变量中读取腾讯云 SecretId
      SecretKey: process.env.COS_SECRET_KEY, // 从环境变量中读取腾讯云 SecretKey
      cdn: { domain: "file.example.com" },
    },
  ],
  upload: [
    {
      source: "dist/**",
      ignore: ["dist/**/*.map"], // 不上传 map 文件
      cwd: __dirname,
      target: `project/${pkg.name}`,
      rename: false,
      flat: false,
      showProgress: false,
      cdnPurgeCache: false,
      cdnPushCache: true, // 上传完成后自动预热 CDN 缓存
      dryRun: false,
      async postUpload() {
        // 上传结束后可以执行一些清理任务
      },
    },
  ],
};
```

4. 在 `package.json` 中 添加 `npm scripts`，打包完成之后自动执行上传 COS 的任务。

```json
{
  "scripts": {
    "serve": "vue-cli-service serve",
    "build": "vue-cli-service build",
    "postbuild": "cos up"
  }
}
```

这样配置后，无论是本地打包还是和 `CI` 流水线集成，都能很方便的管理前端静态资源了。

## Tips

- 执行 `cos upload` 命令时可以添加 `--dry-run` 参数，这样 `coscmd` 只会模拟上传过程，不会实际上传文件，方便查看都有哪些文件会被上传以及上传后的位置是什么了。
- 设置环境变量 `DEBUG=coscmd` 可以查看 `coscmd` 的详细运行日志，包括解析到的配置文件内容，以及每个文件上传时腾讯云返回的错误和响应。
- 如果配置文件中的 `client` 数组的长度（`enable: true`）是 `m`，`upload` 数组的长度是 `n`，最终的上传任务数会是 `m * n`，也就是说，每个客户端都会把每个上传任务执行一次。
- 当配置文件中有多个 `enable` 的客户端时，在执行命令时，可以使用 `--client` 或者 `-c` 参数指定要使用的客户端。不指定则全部 `enable` 的客户端都会生效。
- 可以使用 `--config-file` 参数指定配置文件路径。

## Star 趋势

[![Stargazers over time](https://starchart.cc/haochuan9421/coscmd.svg)](https://starchart.cc/haochuan9421/coscmd)
