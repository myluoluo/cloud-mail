import emailService from './email-service';
import attService from './att-service';
import webhookQueueService from './webhook-queue-service';

const webhookService = {

	async enqueue(c, { emailId, webhookUrl, webhookSecret }) {
		if (!webhookUrl || !webhookSecret || !c.env.notifyQueue) {
			return false;
		}

		const message = webhookQueueService.buildMessage({
			emailId,
			webhookUrl,
			webhookSecret
		});

		await c.env.notifyQueue.send(message);
		return true;
	},

	async consume(c, message) {
		await webhookQueueService.handleMessage(c, message, {
			emailLookup: this.lookupEmail.bind(this),
			attachmentLookup: this.lookupAttachments.bind(this),
		});
	},

	async lookupEmail(c, emailId) {
		return emailService.selectByIdIncludeDel(c, emailId);
	},

	async lookupAttachments(c, emailId) {
		return attService.selectMetaByEmailId(c, emailId);
	}
};

export default webhookService;
