import { defineStore } from 'pinia'

export const useEmailStore = defineStore('email', {
    state: () => ({
        deleteIds: 0,
        starScroll: null,
        emailScroll: null,
        sendScroll: null,
        cancelStarEmailId: 0,
        addStarEmailId: 0,
        unreadEmailId: 0,
        contentData: {
            email: null,
            delType: null,
            showStar: true,
            showReply: true,
            showUnread: false
        },
        // 当前邮件列表，用于详情页导航
        currentEmailList: [],
    }),
    persist: {
        pick: ['contentData'],
    },
})
