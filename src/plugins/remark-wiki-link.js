// Localized from https://github.com/flowershow/remark-wiki-link
// Original project license: MIT.
// The plugin is kept in-repo so wiki-link parsing is not tied to an external
// package release. Its behavior matches the Flowershow plugin used previously.
// @ts-nocheck

import { markdownLineEnding } from 'micromark-util-character'
import { codes } from 'micromark-util-symbol'
import { slug } from 'github-slugger'

const WIKI_LINK_TARGET_PATTERN = /^(.*?)(?:#(.*))?$/u

function syntax(options = {}) {
  const aliasDivider = options.aliasDivider ?? '|'
  const aliasMarker = aliasDivider.charCodeAt(0)
  const startBracket = codes.leftSquareBracket
  const endBracket = codes.rightSquareBracket
  const bang = codes.exclamationMark

  const tokenize = (effects, ok, nok, embedded = false) => {
    let openCount = 0
    let closeCount = 0
    let hasTargetChar = false
    let hasAliasChar = false

    return start

    function start(code) {
      if (embedded) {
        if (code !== bang) return nok(code)
        effects.enter('embed')
        effects.enter('embedMarker')
        effects.consume(code)
        effects.exit('embedMarker')
        return expectFirstBracket
      }
      if (code !== startBracket) return nok(code)
      effects.enter('wikiLinkOpenSequence')
      openCount = 0
      return openSeq(code)
    }

    function expectFirstBracket(code) {
      if (code !== startBracket) return nok(code)
      effects.enter('wikiLinkOpenSequence')
      openCount = 0
      return openSeq(code)
    }

    function openSeq(code) {
      if (code === startBracket) {
        effects.consume(code)
        openCount++
        return openSeq
      }
      if (openCount < 2) return nok(code)
      effects.exit('wikiLinkOpenSequence')
      if (!embedded) effects.enter('wikiLink')
      effects.enter('wikiLinkData')
      effects.enter('wikiLinkTarget')
      return inTarget(code)
    }

    function inTarget(code) {
      if (code === null || code === codes.eof || markdownLineEnding(code)) return nok(code)
      if (code === aliasMarker) {
        if (!hasTargetChar) return nok(code)
        effects.exit('wikiLinkTarget')
        effects.enter('wikiLinkAliasMarker')
        effects.consume(code)
        effects.exit('wikiLinkAliasMarker')
        effects.enter('wikiLinkAlias')
        return inAlias
      }
      if (code === endBracket) {
        if (!hasTargetChar) return nok(code)
        effects.exit('wikiLinkTarget')
        effects.exit('wikiLinkData')
        if (embedded) effects.enter('embedMarker')
        else effects.enter('wikiLinkMarker')
        closeCount = 0
        return closeSeq(code)
      }
      hasTargetChar = true
      effects.consume(code)
      return inTarget
    }

    function inAlias(code) {
      if (code === null || code === codes.eof || markdownLineEnding(code)) return nok(code)
      if (code === endBracket) {
        if (!hasAliasChar) return nok(code)
        effects.exit('wikiLinkAlias')
        effects.exit('wikiLinkData')
        if (embedded) effects.enter('embedMarker')
        else effects.enter('wikiLinkMarker')
        closeCount = 0
        return closeSeq(code)
      }
      hasAliasChar = true
      effects.consume(code)
      return inAlias
    }

    function closeSeq(code) {
      if (code === endBracket) {
        effects.consume(code)
        closeCount++
        if (closeCount === 2) {
          effects.exit(embedded ? 'embedMarker' : 'wikiLinkMarker')
          if (embedded) effects.exit('embed')
          else effects.exit('wikiLink')
          return ok
        }
        return closeSeq
      }
      return nok(code)
    }
  }

  return {
    text: {
      [startBracket]: { tokenize: (effects, ok, nok) => tokenize(effects, ok, nok) },
      [bang]: { tokenize: (effects, ok, nok) => tokenize(effects, ok, nok, true) }
    }
  }
}

function defaultUrlResolver({ filePath, heading, isEmbed = false }) {
  if (isEmbed) return filePath
  const pathWithoutExtension = filePath.replace(/\.(mdx?|md)/, '')
  const normalizedPath = pathWithoutExtension.replace(/\/?(index|README)$/, '')
  const headingId = heading ? `#${slug(heading)}` : ''
  if (headingId && !normalizedPath) return headingId
  return (normalizedPath || '/') + headingId
}

function findMatchingFilePath({ path, files, format, caseInsensitive = true }) {
  if (path.length === 0) return undefined
  const normalizedPath = caseInsensitive ? path.toLowerCase() : path
  if (format === 'regular') {
    return files.find((file) => {
      const fileWithoutExtension = file.replace(/\.(mdx?|md)$/, '')
      const normalizedFile = caseInsensitive ? fileWithoutExtension.toLowerCase() : fileWithoutExtension
      return normalizedFile === normalizedPath
    })
  }
  const matchingFiles = files.filter((file) => {
    const fileWithoutExtension = file.replace(/\.(mdx?|md)$/, '')
    const normalizedFile = caseInsensitive ? fileWithoutExtension.toLowerCase() : fileWithoutExtension
    return normalizedFile.endsWith(normalizedPath)
  })
  return matchingFiles.sort((a, b) => a.length - b.length)[0]
}

function fromMarkdown(options = {}) {
  const format = options.format || 'shortestPossible'
  const files = options.files || []
  const permalinks = options.permalinks || {}
  const caseInsensitive = options.caseInsensitive ?? true
  const className = options.className || 'internal'
  const newClassName = options.newClassName || 'new'
  const urlResolver = options.urlResolver || defaultUrlResolver

  function top(stack) {
    return stack[stack.length - 1]
  }

  function enterWikiLink(token) {
    this.enter({ type: token.type === 'embed' ? 'embed' : 'wikiLink', value: '', data: {} }, token)
  }

  function exitTarget(token) {
    top(this.stack).value = this.sliceSerialize(token)
  }

  function exitAlias(token) {
    top(this.stack).data.alias = this.sliceSerialize(token)
  }

  function exitWikiLink(token) {
    const wikiLink = top(this.stack)
    const { value, data: { alias } } = wikiLink
    if (!value) throw new Error('Empty node value')

    const [, targetPath = '', heading = ''] = value.match(WIKI_LINK_TARGET_PATTERN) || []
    const matchingFilePath = findMatchingFilePath({ path: targetPath, files, format, caseInsensitive })
    const existing = Boolean(matchingFilePath ?? (targetPath.length === 0 && heading))
    const classNames = existing ? className : `${className} ${newClassName}`
    const permalink = matchingFilePath && permalinks[matchingFilePath]
    const url = permalink
      ? heading ? `${permalink}#${heading}` : permalink
      : urlResolver({ filePath: matchingFilePath ?? targetPath, heading, isEmbed: token.type === 'embed' })

    wikiLink.data.existing = existing
    wikiLink.data.path = url

    if (token.type !== 'embed') {
      wikiLink.data.hName = 'a'
      wikiLink.data.hProperties = { href: url, className: classNames }
      wikiLink.data.hChildren = [{ type: 'text', value: alias ?? value }]
    } else {
      const [, name = '', extension = ''] = value.match(/^(.+?)(?:\.([^.]+))?$/) ?? []
      if (['md', 'mdx', ''].includes(extension)) {
        wikiLink.data.hName = 'a'
        wikiLink.data.hProperties = { className: `${classNames} transclusion`, src: url }
        wikiLink.data.hChildren = [{ type: 'text', value: name }]
      } else if (['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'].includes(extension)) {
        const [, width, height] = alias?.match(/^(\d+)(?:x(\d+))?$/) ?? []
        if (width) wikiLink.data.alias = undefined
        wikiLink.data.hName = 'img'
        wikiLink.data.hProperties = {
          src: url, alt: name, className: classNames,
          'data-fs-width': width, 'data-fs-height': height
        }
      } else if (extension === 'pdf') {
        wikiLink.data.hName = 'iframe'
        wikiLink.data.hProperties = { width: '100%', src: url, title: name, className: classNames }
      } else if (['mkv', 'mov', 'mp4', 'ogv', 'webm'].includes(extension)) {
        const [, width, height] = alias?.match(/^(\d+)(?:x(\d+))?$/) ?? []
        if (width) wikiLink.data.alias = undefined
        wikiLink.data.hName = 'video'
        wikiLink.data.hProperties = {
          src: url, className: classNames, controls: true,
          'data-fs-width': width, 'data-fs-height': height
        }
        wikiLink.data.hChildren = [{ type: 'text', value: 'Your browser does not support the video tag.' }]
      } else if (['flac', 'm4a', 'mp3', 'ogg', 'wav', '3gp'].includes(extension)) {
        wikiLink.data.hName = 'audio'
        wikiLink.data.hProperties = { src: url, className: classNames, controls: true }
        wikiLink.data.hChildren = [{ type: 'text', value: 'Your browser does not support the audio tag.' }]
      } else {
        wikiLink.data.hName = 'a'
        wikiLink.data.hProperties = { href: url, className: `${classNames} unsupported` }
        wikiLink.data.hChildren = [{ type: 'text', value }]
      }
    }

    if (matchingFilePath) {
      wikiLink.data.hProperties = { ...wikiLink.data.hProperties, 'data-fs-resolved-file-path': matchingFilePath }
    }
    this.exit(token)
  }

  return {
    enter: { wikiLink: enterWikiLink, embed: enterWikiLink },
    exit: { wikiLinkTarget: exitTarget, wikiLinkAlias: exitAlias, wikiLink: exitWikiLink, embed: exitWikiLink }
  }
}

function toMarkdown(options = {}) {
  const aliasDivider = options.aliasDivider ?? '|'
  const unsafe = [
    { character: '[', inConstruct: ['phrasing', 'label', 'reference'] },
    { character: ']', inConstruct: ['label', 'reference'] }
  ]

  const handler = (node, _parent, state) => {
    const exit = state.enter('wikiLink')
    const nodeValue = state.safe(node.value, { before: '[', after: ']' })
    const nodeAlias = node.data.alias
      ? state.safe(node.data.alias, { before: '[', after: ']' })
      : nodeValue
    const value = nodeAlias !== nodeValue
      ? `[[${nodeValue}${aliasDivider}${nodeAlias}]]`
      : `[[${nodeValue}]]`
    exit()
    return value
  }

  const embedHandler = (node, _parent, state) => {
    const exit = state.enter('embed')
    const nodeValue = state.safe(node.value, { before: '[', after: ']' })
    const width = node.data.hProperties?.['data-fs-width']
    const height = node.data.hProperties?.['data-fs-height']
    let aliasOrDimensions = ''

    if (width || height) {
      aliasOrDimensions = width && height ? `${width}x${height}` : width || ''
    } else if (node.data.alias) {
      aliasOrDimensions = state.safe(node.data.alias, { before: '[', after: ']' })
    }

    const value = aliasOrDimensions
      ? `![[${nodeValue}${aliasDivider}${aliasOrDimensions}]]`
      : `![[${nodeValue}]]`
    exit()
    return value
  }

  return {
    unsafe,
    handlers: { wikiLink: handler, embed: embedHandler }
  }
}

function remarkWikiLink(options = {}) {
  const data = this.data()
  data.toMarkdownExtensions ||= []
  data.micromarkExtensions ||= []
  data.fromMarkdownExtensions ||= []
  data.toMarkdownExtensions.push(toMarkdown(options))
  data.micromarkExtensions.push(syntax(options))
  data.fromMarkdownExtensions.push(fromMarkdown(options))
}

export default remarkWikiLink
export { defaultUrlResolver, findMatchingFilePath, fromMarkdown, remarkWikiLink, syntax, toMarkdown }
