const { ensureDefaultProfile } = require('./utils/common');
const { createListStore } = require('./utils/store');
const { PROFILE_STORE_KEY } = require('./utils/common');

App({
    globalData: {
        appName: '体温用药记录',
    },

    onLaunch() {
        // 首次启动创建默认「本人」档案，并保证存在有效的当前档案
        const profileStore = createListStore({ storageKey: PROFILE_STORE_KEY, sortKey: 'createdAt' });
        ensureDefaultProfile(profileStore);
    },
});
