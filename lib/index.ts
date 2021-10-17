import os from "os";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import DEBUG from "debug";
import { pick } from "lodash";
import isValidDomain from "is-valid-domain";
import glob from "glob";
import { green, red, cyan, gray } from "chalk";
import { SingleBar, Presets } from "cli-progress";
import COS, { COSOptions } from "cos-nodejs-sdk-v5";
import { Client as CDNClient } from "tencentcloud-sdk-nodejs/tencentcloud/services/cdn/v20180606/cdn_client";
import {
  PushUrlsCacheRequest,
  PurgeUrlsCacheRequest,
} from "tencentcloud-sdk-nodejs/tencentcloud/services/cdn/v20180606/cdn_models";
import { ClientConfig as CDNClientConfig } from "tencentcloud-sdk-nodejs/tencentcloud/common/interface";

export interface BucketParams {
  Bucket: string;
  Region: string;
}
export interface SingleClientConfig extends BucketParams, COSOptions {
  // 是否启用这个客户端
  enable?: boolean;
  // COS 关联的 CDN 的相关配置
  cdn?: {
    domain: string; // CDN 加速域名
    config?: CDNClientConfig; // 实例化 CDN Client 时的配置参数
  };
}
export type ClientConfig = SingleClientConfig | SingleClientConfig[];

export interface SingleUploadConfig {
  source: string; // 本地资源，支持单文件、文件夹、glob 表达式
  cwd?: string; // 查找 source 时的工作目录，默认是 process.cwd()
  target?: string; // 保存到 COS 的路径，默认是根路径
  rename?: boolean | number; // 是否对文件进行重命名，如何设置为 true 默认重命名为 16 个小写字母和数字的随机组合，设置为数字可以自定义长度
  flat?: boolean; // 是否铺平文件夹层级
  showProgress?: boolean; // 是否以进度条的形式展示上传过程
  cdnPurgeCache?: boolean | Omit<PurgeUrlsCacheRequest, "Urls">; // 是否刷新 CDN 缓存
  cdnPushCache?: boolean | Omit<PushUrlsCacheRequest, "Urls">; // 是否预热 CDN 缓存
  dryRun?: boolean; // 只模拟上传过程，不实际上传
}
export type UploadConfig = SingleUploadConfig | SingleUploadConfig[];

export interface COSCMDConfig {
  client?: ClientConfig;
  upload?: UploadConfig;
}
export type COSCMDConfigFileContent = COSCMDConfig | (() => Promise<COSCMDConfig>);

// 运行时设置环境变量 DEBUG=coscmd，可以查看 debug 输出
const debug = DEBUG("coscmd");

/**
 * 获取运行时配置，默认读取项目和电脑用户根目录下的 cos.config.js 文件，也可以指定一个配置文件
 * @param configFile 指定配置文件路径
 */
export async function getCOSCMDConfig(configFile?: string): Promise<COSCMDConfig> {
  try {
    debug(`getCOSCMDConfig start`);
    const configFileName = "cos.config.js";
    const configFiles = configFile
      ? [path.resolve(configFile)]
      : [path.join(os.homedir(), configFileName), path.join(process.cwd(), configFileName)];
    const config = await configFiles.reduce(async (promise, file) => {
      try {
        const exists = fs.existsSync(file);
        debug(`${file}${exists ? "" : " not"} exists`);
        if (!exists) {
          return promise;
        }
        const preConfig = await promise;
        debug(`getCOSCMDConfig from ${file} start`);
        const curConfig = await import(file).then((v) => v.default as COSCMDConfigFileContent);
        if (typeof curConfig === "function") {
          const resolvedCurConfig = await curConfig();
          debug(`getCOSCMDConfig from ${file} success`, resolvedCurConfig);
          return {
            ...preConfig,
            ...resolvedCurConfig,
          };
        }
        debug(`getCOSCMDConfig from ${file} success`, curConfig);
        return {
          ...preConfig,
          ...curConfig,
        };
      } catch (error) {
        debug(`getCOSCMDConfig from ${file} fail`, error);
        return promise;
      }
    }, Promise.resolve({}));
    debug(`getCOSCMDConfig success, merged config: `, config);
    return config;
  } catch (error) {
    debug(`getCOSCMDConfig fail`, error);
    throw error;
  }
}

// 改写部分属性为可选
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
// 元组的 shift 操作
export type TupleShift<T extends any[]> = T extends [first: any, ...rest: infer R] ? R : never;
// 被 Proxy 代理后的 COS 类型，这里改写了一些参数中包含 "Bucket" 和 "Region" 字段且为必填的成员方法
export type ProxiedCOS = {
  [P in Exclude<keyof COS, "uploadFiles">]: Parameters<COS[P]>[0] extends BucketParams
    ? (
        // 将 "Bucket" 和 "Region" 设为可选参数，因为代理后的 COS 实例调用这些方法时不需要每次都传这个参数了
        params: PartialBy<Parameters<COS[P]>[0], "Bucket" | "Region">,
        ...args: TupleShift<Parameters<COS[P]>>
      ) => ReturnType<COS[P]>
    : COS[P];
} & {
  uploadFiles: (
    params: Omit<Parameters<COS["uploadFiles"]>[0], "files"> & {
      files: PartialBy<COS.UploadFileItemParams, "Bucket" | "Region">[];
    },
    ...args: TupleShift<Parameters<COS["uploadFiles"]>>
  ) => ReturnType<COS["uploadFiles"]>;
};
// 提取出 COS 成员方法中参数包含 Bucket 和 Region 且必填的全部方法名组成一个联合类型
export type cosRewriteMethodNames =
  | {
      [P in keyof COS]: Parameters<COS[P]>[0] extends BucketParams ? P : never;
    }[keyof COS]
  | "uploadFiles";

export type FileRes = {
  rPath: string; // 本地的相对路径
  fullPath: string; // 本地绝对路径
  cosKey: string; // COS Key
  cosResult: any; // COS 返回的上传结果
  cosError: null | Error; // COS 返回的错误
  url: string; // 上传后的访问地址
};
// upload 方法的返回值类型
export type UploadRes = {
  files: FileRes[];
  startTime: number;
  endTime: number;
};

export class Client {
  static cosProxiedMethods: cosRewriteMethodNames[] = [
    "uploadFiles",
    "abortUploadTask",
    "deleteBucket",
    "deleteBucketCors",
    "deleteBucketDomain",
    "deleteBucketEncryption",
    "deleteBucketInventory",
    "deleteBucketLifecycle",
    "deleteBucketOrigin",
    "deleteBucketPolicy",
    "deleteBucketReplication",
    "deleteBucketTagging",
    "deleteBucketWebsite",
    "deleteMultipleObject",
    "deleteObject",
    "deleteObjectTagging",
    "getBucket",
    "getBucketAccelerate",
    "getBucketAcl",
    "getBucketCors",
    "getBucketDomain",
    "getBucketEncryption",
    "getBucketInventory",
    "getBucketLifecycle",
    "getBucketLocation",
    "getBucketLogging",
    "getBucketOrigin",
    "getBucketPolicy",
    "getBucketReferer",
    "getBucketReplication",
    "getBucketTagging",
    "getBucketVersioning",
    "getBucketWebsite",
    "getObject",
    "getObjectAcl",
    "getObjectStream",
    "getObjectTagging",
    "getObjectUrl",
    "headBucket",
    "headObject",
    "listBucketInventory",
    "listObjectVersions",
    "multipartAbort",
    "multipartComplete",
    "multipartInit",
    "multipartList",
    "multipartListPart",
    "multipartUpload",
    "optionsObject",
    "putBucket",
    "putBucketAccelerate",
    "putBucketAcl",
    "putBucketCors",
    "putBucketDomain",
    "putBucketEncryption",
    "putBucketInventory",
    "putBucketLifecycle",
    "putBucketLogging",
    "putBucketOrigin",
    "putBucketPolicy",
    "putBucketReferer",
    "putBucketReplication",
    "putBucketTagging",
    "putBucketVersioning",
    "putBucketWebsite",
    "putObject",
    "putObjectAcl",
    "putObjectCopy",
    "putObjectTagging",
    "request",
    "restoreObject",
    "selectObjectContent",
    "selectObjectContentStream",
    "sliceCopyFile",
    "sliceUploadFile",
    "uploadFile",
    "uploadPartCopy",
  ];

  /**
   * 生成随机字符串
   * @param {number} [length = 16] 字符串长度，默认 16
   * @returns {string} 随机字符串
   */
  static randomString(length = 16): string {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    const randomArray = new Array(length);
    for (let i = 0; i < length; i++) {
      randomArray[i] = alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return randomArray.join("");
  }

  /**
   * 查找一组字符串的最长公共前缀 https://leetcode-cn.com/problems/longest-courlPmon-prefix/
   * @param {string[]}  strs 一组字符串
   * @returns {string}  最长公共前缀
   */
  static longestCommonPrefix(strs: string[]): string {
    if (!strs.length) {
      return "";
    }
    // 最长公共前缀不可能比最短的字符串长，先遍历一次找出最短字符串
    const minStr = strs.reduce((min, str) => (min.length < str.length ? min : str), strs[0]);
    // 如果最短的那个是空字符串，直接返回 ''
    if (!minStr.length) {
      return "";
    }
    /**
     * 二分纵向比较
     * @param index 二分的位置
     * @param checkStr 待检查的字符串
     * @param commonStr 已检查过相同的部分
     * @returns
     */
    const findCommon = (index: number, checkStr: string, commonStr: string): string => {
      const leftPart = checkStr.substr(0, index);
      let allEqual = true;
      for (let i = 0; i < strs.length; i++) {
        if (strs[i].slice(commonStr.length, commonStr.length + index) !== leftPart) {
          allEqual = false;
          break;
        }
      }
      if (allEqual) {
        const rightPart = checkStr.substr(index);
        commonStr += leftPart;
        // 如果纵向比较都相同且右半边没有待检查的子串，说明已经检查完毕，可以返回 commonStr 了，如果还有右半边的部分没检查，继续检查右半边的子串
        return rightPart.length ? findCommon(Math.ceil(rightPart.length / 2), rightPart, commonStr) : commonStr;
      }
      // 如果纵向比较不相同且子串的长度是1，说明这部分不是相同子串，返回已找到的 commonStr，否则继续二分
      return index === 1 ? commonStr : findCommon(Math.ceil(leftPart.length / 2), leftPart, commonStr);
    };

    return findCommon(Math.ceil(minStr.length / 2), minStr, "");
  }

  domain: string;
  cos: ProxiedCOS;
  cdn?: CDNClient;

  constructor(public config: SingleClientConfig) {
    const { enable, SecretId, SecretKey, Bucket, Region, cdn, ...cosConfig } = config;

    // 实例化 COS
    this.cos = new Proxy(
      new COS({
        SecretId,
        SecretKey,
        ...cosConfig,
      }),
      {
        get: (target, key: cosRewriteMethodNames, recever) => {
          if (key === "uploadFiles") {
            return function (
              params: Parameters<ProxiedCOS["uploadFiles"]>[0],
              ...rest: TupleShift<Parameters<ProxiedCOS["uploadFiles"]>>
            ) {
              return target[key].call(
                target,
                {
                  ...params,
                  // 自动补上 Bucket 和 Region 参数，这样就不需要每次调用 cos 方法的时候都传这个参数了
                  files: params.files.map((file) => ({ Bucket, Region, ...file })),
                },
                ...rest
              );
            };
          } else if (Client.cosProxiedMethods.includes(key)) {
            // @ts-ignore 可耻的用一下，实在想不出来怎么处理
            return function (params, ...rest) {
              return target[key].call(
                target,
                // 自动补上 Bucket 和 Region 参数，这样就不需要每次调用 cos 方法的时候都传这个参数了
                { Bucket, Region, ...params },
                // @ts-ignore +1
                ...rest
              );
            };
          }
          return Reflect.get(target, key, recever);
        },
      }
    ) as ProxiedCOS;

    // 实例化 CDN
    if (
      cdn &&
      (cdn.config || (SecretId && SecretKey)) &&
      isValidDomain(cdn.domain, { allowUnicode: true, subdomain: true, topLevel: false, wildcard: false })
    ) {
      this.domain = cdn.domain;
      this.cdn = new CDNClient(
        cdn.config || {
          credential: { secretId: SecretId, secretKey: SecretKey },
          region: "",
          profile: { httpProfile: { endpoint: "cdn.tencentcloudapi.com" } },
        }
      );
    } else {
      this.domain = `${Bucket}.cos.${Region}.myqcloud.com`;
    }
  }

  /**
   * 上传文件
   * @param uploadConfig
   * @returns
   */
  async upload(uploadConfig: SingleUploadConfig): Promise<UploadRes> {
    try {
      debug(`upload start`, uploadConfig);
      const {
        source,
        cwd = process.cwd(),
        target = "",
        rename,
        flat,
        showProgress,
        cdnPurgeCache,
        cdnPushCache,
        dryRun,
      } = uploadConfig;

      if (!source) {
        throw new Error("source should be nonempty string");
      }
      const normalizedTarget = target.startsWith("/") ? target.slice(1) : target;

      let files: Pick<FileRes, "rPath" | "fullPath" | "cosKey">[] = [];

      const uploadRes: UploadRes = {
        files: [],
        startTime: Date.now(),
        endTime: 0,
      };

      const sourcePath = path.resolve(cwd, source);
      if (fs.existsSync(sourcePath)) {
        const stat = await fs.promises.stat(sourcePath);
        if (stat.isFile()) {
          debug(`upload "source" is file`);
          files = [sourcePath].map((fullPath) => {
            const parsed = path.parse(fullPath);
            const cosKey =
              parsed.ext === path.extname(normalizedTarget)
                ? normalizedTarget
                : path.join(
                    normalizedTarget,
                    `${rename ? Client.randomString(rename === true ? 16 : rename) : parsed.name}${parsed.ext}`
                  );

            return { rPath: path.relative(cwd, fullPath), fullPath, cosKey };
          });
        } else if (stat.isDirectory()) {
          debug(`upload "source" is directory`);
          const dirname = path.relative(cwd, sourcePath);
          files = (await promisify(glob)(`${dirname}/**`, { cwd, nodir: true, dot: true })).map((matchedPath) => {
            const fullPath = path.resolve(cwd, matchedPath);
            const renamedFilePath = rename
              ? path.format({
                  ...pick(path.parse(fullPath), ["dir", "ext"]),
                  name: Client.randomString(rename === true ? 16 : rename),
                })
              : fullPath;
            const cosKey = path.join(
              normalizedTarget,
              flat ? path.basename(renamedFilePath) : path.relative(sourcePath, renamedFilePath)
            );

            return { rPath: path.relative(cwd, fullPath), fullPath, cosKey };
          });
        } else {
          debug(`upload "source" not support`);
          throw new Error("unsupport file type");
        }
      } else {
        debug(`use upload "source" as glob pattern`);
        const fullPaths = (await promisify(glob)(source, { cwd, nodir: true, dot: true })).map((matchedPath) =>
          path.resolve(cwd, matchedPath)
        );

        if (fullPaths.length) {
          // 找出所有匹配到的文件的公共访问路径
          const commonPrefix = Client.longestCommonPrefix(fullPaths);
          const commonDir = commonPrefix.endsWith("/") ? commonPrefix : path.dirname(commonPrefix);

          files = fullPaths.map((fullPath) => {
            const renamedFilePath = rename
              ? path.format({
                  ...pick(path.parse(fullPath), ["dir", "ext"]),
                  name: Client.randomString(rename === true ? 16 : rename),
                })
              : fullPath;
            const cosKey = path.join(
              normalizedTarget,
              flat ? path.basename(renamedFilePath) : path.relative(commonDir, renamedFilePath)
            );
            return { rPath: path.relative(cwd, fullPath), fullPath, cosKey };
          });
        }
      }

      debug(`upload "source" total count is ${files.length}`);

      if (dryRun) {
        uploadRes.files = files.map(({ rPath, fullPath, cosKey }) => ({
          rPath,
          fullPath,
          cosKey,
          cosResult: null,
          cosError: null,
          url: `https://${this.domain}/${cosKey}`,
        }));
      } else if (files.length) {
        await new Promise<void>((resolve) => {
          const maxPathLength = Math.max(...files.map(({ rPath }) => rPath.length));
          const totalCount = files.length;

          this.cos.uploadFiles({
            files: files.map(({ rPath, fullPath, cosKey }) => ({
              FilePath: fullPath,
              Key: cosKey,
              onFileFinish: (cosError, cosResult) => {
                const url = cosError ? "" : `https://${this.domain}/${cosKey}`;
                if (!showProgress) {
                  console.log(
                    `${rPath} ${gray(`${"-".repeat(maxPathLength - rPath.length + 3)}>`)} ${
                      cosError ? red(cosKey) : green.underline(url)
                    }`
                  );
                }

                const fileRes = { rPath, fullPath, cosKey, cosError, cosResult, url };
                debug("fileRes", fileRes);
                uploadRes.files.push(fileRes);
                if (uploadRes.files.length === totalCount) {
                  resolve();
                }
              },
            })),
            SliceSize: 50 * 1024 * 1024, // 文件大于 50M 以上的使用分片上传
            ...(showProgress
              ? ((): Pick<COS.UploadFileItemParams, "onProgress"> => {
                  const bar = new SingleBar(
                    {
                      format: `上传进度 [{bar}] {percent}% | {speed} | 文件总数 ${cyan("{totalCount}")} | 成功 ${green(
                        "{successCount}"
                      )} | 失败 ${red("{failCount}")}`,
                      barsize: 30, // bar 的宽度
                    },
                    Presets.legacy
                  );
                  bar.start(Number.MAX_SAFE_INTEGER, 0, {
                    percent: 0,
                    speed: "N/A",
                    successCount: 0,
                    failCount: 0,
                    totalCount,
                  });

                  return {
                    onProgress: ({ loaded, total, speed, percent }) => {
                      const uploadedCount = uploadRes.files.length;
                      const successCount = uploadRes.files.filter(({ cosError }) => !cosError).length;
                      bar.setTotal(total);
                      bar.update(loaded, {
                        percent: Math.floor(percent * 100),
                        speed:
                          speed > 1024 * 1024
                            ? `${(speed / 1024 / 1024).toFixed(2)}MB/s`
                            : `${(speed / 1024).toFixed(2)}KB/s`,
                        successCount: successCount,
                        failCount: uploadedCount - successCount,
                      });
                      if (uploadedCount === totalCount) {
                        bar.stop();
                      }
                    },
                  };
                })()
              : null),
          });
        });

        if (this.cdn) {
          if (cdnPurgeCache) {
            for (let i = 0; i < uploadRes.files.length; i += 1000) {
              const Urls = uploadRes.files.slice(i, i + 1000).map((file) => file.url);
              // 每次最多 1000 条
              await this.cdn.PurgeUrlsCache({ Urls, ...(cdnPurgeCache === true ? null : cdnPurgeCache) });
            }
            console.log(green("CDN 缓存刷新成功"));
          }
          if (cdnPushCache) {
            for (let i = 0; i < uploadRes.files.length; i += 20) {
              const Urls = uploadRes.files.slice(i, i + 20).map((file) => file.url);
              // 每次最多 20 条
              await this.cdn.PushUrlsCache({ Urls, ...(cdnPushCache === true ? null : cdnPushCache) });
            }
            console.log(green("CDN 缓存预热成功"));
          }
        }
      }

      return {
        ...uploadRes,
        endTime: Date.now(),
      };
    } catch (error) {
      debug(`upload fail`, error);
      throw error;
    }
  }
}
