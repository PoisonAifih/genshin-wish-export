<template>
  <div class="bg-white pt-2 pb-4 px-6 w-full h-full absolute inset-0">
    <div class="flex content-center items-center mb-4 justify-between">
      <h3 class="text-lg">{{text.title}}</h3>
      <el-button icon="close" @click="closeSetting" plain circle type="default" class="w-8 h-8 relative -right-4 -top-2 shadow-md focus:shadow-none focus:outline-none"></el-button>
    </div>
    <el-form :model="settingForm" label-width="120px">
      <el-form-item :label="text.language">
        <el-select @change="saveLang" v-model="settingForm.lang">
          <el-option v-for="item of data.langMap" :key="item[0]" :label="item[1]" :value="item[0]"></el-option>
        </el-select>
        <p class="text-gray-400 text-xs m-1.5">{{text.languageHint}}</p>
      </el-form-item>
      <el-form-item :label="text.logType">
        <el-radio-group @change="saveSetting" v-model.number="settingForm.logType">
          <el-radio-button :label="0">{{text.auto}}</el-radio-button>
          <el-radio-button :label="1">{{text.cnServer}}</el-radio-button>
          <el-radio-button :label="2">{{text.seaServer}}</el-radio-button>
          <el-radio-button v-if="settingForm.lang === 'zh-cn'" :label="3">云原神</el-radio-button>
        </el-radio-group>
        <p class="text-gray-400 text-xs m-1.5">{{text.logTypeHint}}</p>
      </el-form-item>
      <el-form-item :label="text.UIGFLable">
        <div class="flex space-x-2">
          <el-button :loading="data.loadingOfUIGFJSON" class="focus:outline-none" plain type="primary" @click="importUIGFJSON">{{ text.UIGFImportButton }}</el-button>
          <el-button :loading="data.loadingOfUIGFJSON" class="focus:outline-none" plain type="success" @click="exportUIGFJSON">{{ text.UIGFButton }}</el-button>
          <el-select class="w-24" v-model="settingForm.uigfVersion">
            <el-option
              v-for="version in uigfSupportedVersions"
              :key="version"
              :label="'UIGFv' + version"
              :value="version"
            />
          </el-select>
          <el-checkbox v-if="settingForm.uigfVersion === uigfSupportedVersions[0]" v-model="settingForm.uigfAllAccounts">{{ text.UIGFAllAccounts }}</el-checkbox>
          <el-checkbox v-model="settingForm.readableJSON" @change="saveSetting">{{ text.UIGFReadable }}</el-checkbox>
        </div>
        <p class="text-gray-400 text-xs m-1.5 leading-normal">{{ text.UIGFHint }}
          <a class="cursor-pointer text-blue-400"
             @click="openLink(`https://uigf.org/${settingForm.lang.startsWith('zh-') ? 'zh/': 'en/'}`)">{{ text.UIGFLink }}</a>
        </p>
      </el-form-item>
      <el-form-item :label="text.workbookLabel">
        <div class="flex space-x-2 items-center w-full">
          <el-input class="w-80" :model-value="workbook.path" readonly :placeholder="text.workbookPlaceholder"></el-input>
          <el-button class="focus:outline-none" plain @click="pickWorkbook">{{ text.workbookPick }}</el-button>
          <el-button :loading="workbook.loading" :disabled="!workbook.path" class="focus:outline-none" plain type="success" @click="appendWorkbook">{{ text.workbookAppend }}</el-button>
          <a class="cursor-pointer text-gray-400 text-xs" @click="ipcRenderer.invoke('WORKBOOK_SHOW_BACKUPS')">{{ text.workbookBackups }}</a>
        </div>
        <p class="text-gray-400 text-xs m-1.5 leading-normal">{{ text.workbookHint }}</p>
      </el-form-item>
      <el-form-item :label="text.googleLabel">
        <div class="flex flex-col w-full">
          <div v-if="showCredentialFields" class="flex space-x-2 mb-2">
            <el-input class="w-64" v-model="google.clientId" @change="saveGoogle" :placeholder="text.googleClientId"></el-input>
            <el-input class="w-64" v-model="google.clientSecret" @change="saveGoogle" type="password" show-password
              :placeholder="google.hasClientSecret ? '••••••••••••' : text.googleClientSecret"></el-input>
          </div>
          <div class="flex space-x-2 mb-2">
            <el-input class="w-64" v-model="google.spreadsheetId" @change="saveGoogle" :placeholder="text.googleSpreadsheetId"></el-input>
            <el-input class="w-64" v-model="google.bannerName" @change="saveGoogle" :placeholder="text.googleBannerName"></el-input>
          </div>
          <div class="flex space-x-2 items-center">
            <el-button :loading="google.connecting" :disabled="!hasCredentials" class="focus:outline-none" plain type="primary" @click="connectGoogle">
              {{ google.connected ? text.googleReconnect : text.googleConnect }}
            </el-button>
            <el-button v-if="google.connected" class="focus:outline-none" plain type="danger" @click="disconnectGoogle">{{ text.googleDisconnect }}</el-button>
            <el-button :loading="google.loading" :disabled="!google.connected" class="focus:outline-none" plain type="success" @click="exportGoogleSheets">{{ text.googleExport }}</el-button>
            <span class="text-xs" :class="google.connected ? 'text-green-500' : 'text-gray-400'">
              {{ google.connected ? text.googleConnected : text.googleNotConnected }}
            </span>
            <a v-if="google.spreadsheetId" class="cursor-pointer text-blue-400 text-xs"
              @click="openLink(`https://docs.google.com/spreadsheets/d/${google.spreadsheetId}/edit`)">{{ text.googleOpen }}</a>
            <a v-if="hasCredentials" class="cursor-pointer text-gray-400 text-xs"
              @click="google.showCredentials = !google.showCredentials">{{ text.googleCredentialsToggle }}</a>
          </div>
        </div>
        <p v-if="showCredentialFields" class="text-gray-400 text-xs m-1.5 leading-normal">{{ text.googleHint }}
          <a class="cursor-pointer text-blue-400" @click="openLink('https://console.cloud.google.com/apis/credentials')">{{ text.googleGuide }}</a>
        </p>
        <p v-if="showCredentialFields" class="text-gray-400 text-xs m-1.5 leading-normal">{{ text.googleTokenHint }}</p>
        <p class="text-gray-400 text-xs m-1.5 leading-normal">{{ text.googleSpreadsheetHint }} {{ text.googleBannerHint }}</p>
      </el-form-item>
      <el-form-item :label="text.autoUpdate">
        <el-switch
          @change="saveSetting"
          v-model="settingForm.autoUpdate">
        </el-switch>
      </el-form-item>
      <el-form-item :label="text.hideNovice">
        <el-switch
          @change="saveSetting"
          v-model="settingForm.hideNovice">
        </el-switch>
      </el-form-item>
      <el-form-item :label="text.fetchFullHistory">
        <el-switch
          @change="saveSetting"
          v-model="settingForm.fetchFullHistory">
        </el-switch>
        <p class="text-gray-400 text-xs m-1.5">{{text.fetchFullHistoryHint}}</p>
      </el-form-item>
    </el-form>
    <h3 class="text-lg my-4">{{about.title}}</h3>
    <p class="text-gray-600 text-xs mt-1">{{about.license}}</p>
    <p class="text-gray-600 text-xs mt-1 pb-6">Github: <a @click="openGithub" class="cursor-pointer text-blue-400">https://github.com/biuuu/genshin-wish-export</a></p>
  </div>
</template>

<script setup>
const { ipcRenderer, shell } = require('electron')
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

const emit = defineEmits(['close', 'changeLang', 'dataUpdated'])

const props = defineProps({
  i18n: Object
})

const data = reactive({
  langMap: new Map(),
  loadingOfUIGFJSON: false
})

const settingForm = reactive({
  lang: 'zh-cn',
  logType: 1,
  proxyMode: true,
  autoUpdate: true,
  fetchFullHistory: false,
  hideNovice: true,
  gistsToken: '',
  uigfVersion: "4.1",
  uigfAllAccounts: true,
  readableJSON: false
})

const uigfSupportedVersions = [
  "4.1",
  "3.0"
]

const google = reactive({
  clientId: '',
  clientSecret: '',
  spreadsheetId: '',
  bannerName: '',
  connected: false,
  hasClientId: false,
  hasClientSecret: false,
  showCredentials: false,
  connecting: false,
  loading: false
})

const hasCredentials = computed(() => google.hasClientId && google.hasClientSecret)

/* Once the OAuth client is stored the panel collapses down to a plain sign-in button;
   the credential fields are a one-time setup step, not something to look at every day. */
const showCredentialFields = computed(() => !hasCredentials.value || google.showCredentials)

/* ipcRenderer wraps rejections as "Error invoking remote method 'X': Error: ..." */
const cleanMessage = (e) => {
  const message = e && e.message ? e.message : String(e)
  return message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

const text = computed(() => props.i18n.ui.setting)
const about = computed(() => props.i18n.ui.about)

const saveSetting = async () => {
  const keys = ['lang', 'logType', 'proxyMode', 'autoUpdate', 'fetchFullHistory', 'hideNovice', 'gistsToken', 'readableJSON']
  for (let key of keys) {
    await ipcRenderer.invoke('SAVE_CONFIG', [key, settingForm[key]])
  }
}

const saveLang = async () => {
  await saveSetting()
  emit('changeLang')
}

const closeSetting = () => emit('close')

const disableProxy = async () => {
  await ipcRenderer.invoke('DISABLE_PROXY')
}

const openGithub = () => shell.openExternal('https://github.com/biuuu/genshin-wish-export')
const openLink = (link) => shell.openExternal(link)

const exportUIGFJSON = async () => {
  data.loadingOfUIGFJSON = true
  try {
    await ipcRenderer.invoke('EXPORT_UIGF_JSON', settingForm.uigfVersion, settingForm.uigfAllAccounts)
  } catch (e) {
    ElMessage({
      message: e.message || e,
      type: 'error'
    })
  } finally {
    data.loadingOfUIGFJSON = false
  }
}

const importUIGFJSON = async () => {
  data.loadingOfUIGFJSON = true
  try {
    const result = await ipcRenderer.invoke('IMPORT_UIGF_JSON')
    if (result === 'canceled') {
      return
    }
    emit('dataUpdated')
    closeSetting()
    ElMessage({
      message: text.value.UIGFImportSuccessed,
      type: 'success'
    })
  } catch (e) {
    ElMessage({
      message: e.message || e,
      type: 'error'
    })
  } finally {
    data.loadingOfUIGFJSON = false
  }
}

const workbook = reactive({ path: '', loading: false })

const pickWorkbook = async () => {
  workbook.path = await ipcRenderer.invoke('WORKBOOK_PICK')
}

const appendWorkbook = async () => {
  workbook.loading = true
  try {
    const result = await ipcRenderer.invoke('WORKBOOK_APPEND')
    ElMessage({
      message: result.added
        ? text.value.workbookSuccess.replace('${count}', result.added)
        : text.value.workbookNothingNew,
      type: 'success'
    })
    const skipped = result.summary.filter(item => item.skipped).map(item => item.title)
    if (skipped.length) {
      ElMessage({
        message: text.value.workbookSkipped.replace('${sheets}', skipped.join(', ')),
        type: 'warning',
        duration: 8000
      })
    }
  } catch (e) {
    ElMessage({ message: cleanMessage(e), type: 'error', duration: 10000 })
  } finally {
    workbook.loading = false
  }
}

const loadGoogleStatus = async () => {
  const status = await ipcRenderer.invoke('GOOGLE_SHEETS_STATUS')
  google.clientId = status.clientId
  google.spreadsheetId = status.spreadsheetId
  google.bannerName = status.bannerName
  google.connected = status.connected
  google.hasClientId = status.hasClientId
  google.hasClientSecret = status.hasClientSecret
}

const saveGoogle = async () => {
  await ipcRenderer.invoke('GOOGLE_SHEETS_SAVE', {
    clientId: google.clientId,
    clientSecret: google.clientSecret,
    spreadsheetId: google.spreadsheetId,
    bannerName: google.bannerName
  })
  google.clientSecret = ''
  await loadGoogleStatus()
}

const connectGoogle = async () => {
  google.connecting = true
  try {
    await saveGoogle()
    await ipcRenderer.invoke('GOOGLE_SHEETS_CONNECT')
    await loadGoogleStatus()
    ElMessage({ message: text.value.googleConnectSuccess, type: 'success' })
  } catch (e) {
    ElMessage({ message: cleanMessage(e), type: 'error' })
  } finally {
    google.connecting = false
  }
}

const disconnectGoogle = async () => {
  await ipcRenderer.invoke('GOOGLE_SHEETS_DISCONNECT')
  await loadGoogleStatus()
}

const exportGoogleSheets = async () => {
  google.loading = true
  try {
    await saveGoogle()
    const result = await ipcRenderer.invoke('GOOGLE_SHEETS_EXPORT')
    google.spreadsheetId = result.spreadsheetId
    const added = result.summary.reduce((sum, item) => sum + item.added, 0)
    ElMessage({
      message: added
        ? text.value.googleExportSuccess.replace('${count}', added)
        : text.value.googleNothingNew,
      type: 'success'
    })

    const skipped = result.summary.filter(item => item.skipped).map(item => item.title)
    if (skipped.length) {
      ElMessage({
        message: text.value.googleSkipped.replace('${sheets}', skipped.join(', ')),
        type: 'warning',
        duration: 8000
      })
    }
  } catch (e) {
    ElMessage({ message: cleanMessage(e), type: 'error' })
  } finally {
    google.loading = false
  }
}

const gistsConfigDisabled = ref(true)

const configGistsToken = () => {
  gistsConfigDisabled.value = false
  openLink('https://github.com/settings/personal-access-tokens/new')
}

const saveGistsToken = async () => {
  gistsConfigDisabled.value = true
  await saveSetting()
}

const uploadGistsLoading = ref(false)
const uploadGists = async () => {
  uploadGistsLoading.value = true
  const result = await ipcRenderer.invoke('EXPORT_UIGF_JSON_GISTS')
  if (result === 'successed') {
    ElMessage({
      message: '上传数据成功',
      type: 'success',
    })
  } else {
    ElMessage({
      message: result,
      type: 'error',
    })
  }
  uploadGistsLoading.value = false
}

onMounted(async () => {
  data.langMap = await ipcRenderer.invoke('LANG_MAP')
  const config = await ipcRenderer.invoke('GET_CONFIG')
  Object.assign(settingForm, config)
  await loadGoogleStatus()
  workbook.path = (await ipcRenderer.invoke('WORKBOOK_STATUS')).path
})

</script>

<style>
.el-form-item__label {
  line-height: normal !important;
  position: relative;
  top: 6px;
}
.el-form-item__content {
  flex-direction: column;
  align-items: start !important;
}
.el-form-item--default {
  margin-bottom: 14px !important;
}
</style>
