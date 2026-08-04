import { bundleID, companyName, productName, version } from './package.json'

const isCustomBuild = process.env.DESKTOP_CUSTOM_BUILD === '1'

export function getProductName() {
  if (isCustomBuild) {
    return 'GitHub Desktop Custom'
  }

  return process.env.NODE_ENV === 'development'
    ? `${productName}-dev`
    : productName
}

export function getCompanyName() {
  return companyName
}

export function getVersion() {
  return version
}

export function getBundleID() {
  if (isCustomBuild) {
    return 'com.faithk7.GitHubDesktopCustom'
  }

  return process.env.NODE_ENV === 'development' ? `${bundleID}Dev` : bundleID
}

export function getIsCustomBuild() {
  return isCustomBuild
}
