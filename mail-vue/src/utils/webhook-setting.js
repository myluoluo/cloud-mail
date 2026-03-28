export function buildWebhookSettingForm({ webhookStatus, webhookUrl, webhookSecret, clearWebhookSecret }) {
    const form = {
        webhookStatus,
        webhookUrl,
    }

    if (clearWebhookSecret) {
        form.webhookSecret = ''
        return form
    }

    if (webhookSecret) {
        form.webhookSecret = webhookSecret
    }

    return form
}

export function validateWebhookSettingForm({ webhookStatus, webhookUrl, webhookSecret, clearWebhookSecret }, { hasSavedSecret }) {
    if (webhookStatus !== 0) {
        return null
    }

    if (!webhookUrl) {
        return 'webhookUrlRequiredMsg'
    }

    if (clearWebhookSecret) {
        return 'webhookSecretRequiredMsg'
    }

    if (webhookSecret || hasSavedSecret) {
        return null
    }

    return 'webhookSecretRequiredMsg'
}

export function createWebhookSettingDraft({ webhookStatus, webhookUrl }) {
    return {
        webhookStatus,
        webhookUrl,
        webhookSecret: '',
        clearWebhookSecret: false,
    }
}
