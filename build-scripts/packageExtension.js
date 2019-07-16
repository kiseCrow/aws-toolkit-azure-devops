/*!
 * Copyright 2019 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT
 */

const fs = require('fs-extra')
const path = require('path')
const ncp = require('child_process')
const shell = require('shelljs')
const folders = require('./scriptUtils')

const timeMessage = 'Packaged extension'
const manifestFile = 'vss-extension.json'

const ignoredFolders = ['Common', '.DS_Store']

const vstsFiles = ['task.json', 'task.loc.json', 'package.json', 'icon.png', 'Strings']

function findMatchingFiles(directory) {
    return fs.readdirSync(directory)
}

function package(options) {
    fs.mkdirpSync(folders.packageRoot)

    fs.copySync(path.join(folders.repoRoot, 'LICENSE'), path.join(folders.packageRoot, 'LICENSE'), { overwrite: true })
    fs.copySync(path.join(folders.repoRoot, 'README.md'), path.join(folders.packageRoot, 'README.md'), {
        overwrite: true
    })
    fs.copySync(path.join(folders.repoRoot, '_build', manifestFile), path.join(folders.packageRoot, manifestFile), {
        overwrite: true
    })
    // Do a best effort job of generating a git hash and putting it into the package
    try {
        let response = shell.exec('git rev-parse HEAD')
        if (response.code !== 0) {
            console.log('Warning: unable to run git rev-parse to get commit hash!')
        } else {
            fs.outputFileSync(path.join(folders.packageRoot, '.gitcommit'), response.stdout)
        }
    } catch (e) {
        console.log('Getting commit hash failed ' + e)
    }

    // stage manifest images
    fs.copySync(path.join(folders.repoRoot, 'images'), path.join(folders.packageRoot, 'images'), { overwrite: true })

    fs.mkdirpSync(folders.packageTasks)

    // clean, dedupe and pack each task as needed
    findMatchingFiles(folders.sourceTasks).forEach(function(taskName) {
        console.log('Processing task ' + taskName)

        if (
            ignoredFolders.some(folderName => {
                return folderName === taskName
            })
        ) {
            console.log('Skpping task ' + taskName)
            return
        }

        const taskBuildFolder = path.join(folders.buildTasks, taskName)
        const taskPackageFolder = path.join(folders.packageTasks, taskName)
        fs.mkdirpSync(taskPackageFolder)

        const taskDef = require(path.join(taskBuildFolder, 'task.json'))
        if (!taskDef.execution.hasOwnProperty('Node')) {
            console.log('Copying non-node task ' + taskName)

            fs.copySync(taskBuildFolder, taskPackageFolder)
            return
        }
        shell.cd(taskBuildFolder)
        for (const resourceFile of vstsFiles) {
            fs.copySync(path.join(taskBuildFolder, resourceFile), path.join(taskPackageFolder, resourceFile), {
                overwrite: true
            })
        }

        // Here we grab either TASKNAME.js or TASKNAME.runner.js depending on which one exists
        // We need to package one file and as of now we have a mix of hand written (.js) and autogenerated
        // files (.runner.js). Once they are all converted to be generated, this can be removed
        // TODO https://github.com/aws/aws-vsts-tools/issues/187 when this is done, remove the check
        var inputFilename
        try {
            fs.accessSync(taskName + '.js')
            inputFilename = taskName + '.js'
        } catch (e) {
            inputFilename = taskName + '.runner.js'
        }

        console.log('packing node-based task')
        const webpackConfig = path.join(folders.repoRoot, 'webpack.config.js')
        const webpackCmd =
            'webpack ' +
            '--config ' +
            webpackConfig +
            ' ' +
            inputFilename +
            ' ' +
            '--output-path ' +
            path.join(taskPackageFolder) +
            ' ' +
            '--output-filename ' +
            taskName +
            '.js' +
            ' '
        console.log(webpackCmd)
        try {
            ncp.execSync(webpackCmd, { stdio: 'pipe' })
        } catch (err) {
            console.error(err.output ? err.output.toString() : err.message)
            process.exit(1)
        }

        shell.cd(taskPackageFolder)
        var npmCmd = 'npm install vsts-task-lib --only=production'
        try {
            output = ncp.execSync(npmCmd, { stdio: 'pipe' })
            console.log(output)
        } catch (err) {
            console.error(err.output ? err.output.toString() : err.message)
            process.exit(1)
        }

        shell.cd(folders.repoRoot)
    })

    console.log('Creating deployment vsix')
    var tfxcmd =
        'tfx extension create --root ' +
        folders.packageRoot +
        ' --output-path ' +
        folders.packageRoot +
        ' --manifests ' +
        path.join(folders.packageRoot, manifestFile)
    if (options.publisher) {
        tfxcmd += ' --publisher ' + options.publisher
    }

    console.log('Packaging with:' + tfxcmd)

    ncp.execSync(tfxcmd, { stdio: 'pipe' })

    console.log('Packaging successful')
}

console.time(timeMessage)
var options = process.argv.slice(2)
if (options.length > 0 && options[0].split('=')[0] === 'publisher') {
    options.publisher = options[0].split('=')[1]
}
package(options)
console.timeEnd(timeMessage)
