import chalk from "chalk"
import { debug } from "../../debug"

import { getPlatformForEnv, Platform } from "../../platforms/platform"
import { Executor, ExecutorOptions } from "../../runner/Executor"
import { runDangerSubprocess } from "../utils/runDangerSubprocess"
import { SharedCLI } from "../utils/sharedDangerfileArgs"
import getRuntimeCISource from "../utils/getRuntimeCISource"

import inlineRunner from "../../runner/runners/inline"
import { jsonDSLGenerator } from "../../runner/dslGenerator"
import dangerRunToRunnerCLI from "../utils/dangerRunToRunnerCLI"
import { CISource } from "../../ci_source/ci_source"
import { readFileSync } from "fs"
import { join } from "path"

const d = debug("process_runner")

export interface RunnerConfig {
  /** The CI source that could come from an external source */
  source?: CISource
  /** A platform which could come for us come from outside */
  platform?: Platform
  /** Args which should get passed into the subprocess */
  additionalArgs?: string[]
  /** Replace the default danger-js sub-process runner with something else */
  process?: string
}

export const runRunner = async (app: SharedCLI, config?: RunnerConfig) => {
  const appPackageContent = readFileSync(join(__dirname, "../../../package.json"), "utf8")
  const { version } = JSON.parse(appPackageContent)
  d(`Debug mode on for Danger v${version}`)
  d(`Starting sub-process run`)

  const configSource = config && config.source
  const source = configSource || (await getRuntimeCISource(app))

  // This does not set a failing exit code, because it's also likely
  // danger is running on a CI run on the merge of a PR, and not just
  // the PR runs itself. This means failing CI when it's not really
  // danger's responsibility to run
  if (source && !source.isPR) {
    console.log("Skipping Danger due to this run not executing on a PR.")
  }

  // The optimal path when on a PR
  if (source && source.isPR) {
    const configPlatform = config && config.platform
    const platform = configPlatform || getPlatformForEnv(process.env, source)

    // You could have accidentally set it up on GitLab for example
    if (!platform) {
      console.log(chalk.red(`Could not find a source code hosting platform for ${source.name}.`))
      console.log(
        `Currently Danger JS only supports GitHub and BitBucket Server, if you want other platforms, consider the Ruby version or help add support.`
      )
      process.exitCode = 1
    }

    if (platform) {
      const dangerJSONDSL = await jsonDSLGenerator(platform, source)
      const execConfig: ExecutorOptions = {
        stdoutOnly: !platform.supportsCommenting() || app.textOnly,
        verbose: app.verbose,
        jsonOnly: false,
        dangerID: app.id || "default",
      }

      // if the host process has used
      const processName = app.config || (config && config.process)
      const configProcessArgs = processName && processName.split(" ")
      const runnerCommand = configProcessArgs || dangerRunToRunnerCLI(process.argv)
      d(`Preparing to run: ${runnerCommand}`)

      const exec = new Executor(source, platform, inlineRunner, execConfig)
      runDangerSubprocess(runnerCommand, dangerJSONDSL, exec, app)
    }
  }
}
