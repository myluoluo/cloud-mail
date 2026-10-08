import s3Service from './s3-service';
import settingService from './setting-service';
import kvObjService from './kv-obj-service';

// 公开对象键前缀白名单：/api/oss/*、/oss/ 与 /static/、/attachments/ 只允许读这些前缀。
// 系统数据 KV 键（setting:、auth-uid:、public_key: 等）都不带这两个前缀，前缀即完整边界：
// KV/R2/S3 均为扁平键空间、不做路径解析，而对象键本身也不是 URI 编码串
// （附件后缀直接取自邮件文件名，可能含 '%'、':' 等字符），因此这里不能对键做解码。
const PUBLIC_OBJECT_PREFIXES = ['static/', 'attachments/'];

function isPublicObjectKey(key) {
	return typeof key === 'string'
		&& PUBLIC_OBJECT_PREFIXES.some((prefix) => key.startsWith(prefix));
}

const r2Service = {

	async storageType(c) {

		const setting = await settingService.query(c);
		const { bucket, endpoint, s3AccessKey, s3SecretKey } = setting;

		if (!!(bucket && endpoint && s3AccessKey && s3SecretKey)) {
			return 'S3';
		}

		if (c.env.r2) {
			return 'R2';
		}

		return 'KV';
	},

	async putObj(c, key, content, metadata) {

		const storageType = await this.storageType(c);

		if (storageType === 'KV') {
			await kvObjService.putObj(c, key, content, metadata);
		}

		if (storageType === 'R2') {
			await c.env.r2.put(key, content, {
				httpMetadata: { ...metadata }
			});
		}

		if (storageType === 'S3') {
			await s3Service.putObj(c, key, content, metadata);
		}

	},

	async getObj(c, key) {
		if (!isPublicObjectKey(key)) {
			return null;
		}
		const storageType = await this.storageType(c);

		if (storageType === 'KV') {
			return await kvObjService.getObj(c, key);
		}

		if (storageType === 'R2') {
			return await c.env.r2.get(key);
		}

		if (storageType === 'S3') {
			return await s3Service.getObj(c, key);
		}
	},

	/**
	 * Always returns a Response (or null if missing) so HTTP handlers
	 * can serve KV / R2 / S3 the same way.
	 */
	async toObjResp(c, key) {
		if (!isPublicObjectKey(key)) {
			return null;
		}
		try {
			const storageType = await this.storageType(c);

			if (storageType === 'KV') {
				return await kvObjService.getObj(c, key);
			}

			if (storageType === 'R2') {
				const obj = await c.env.r2.get(key);
				if (!obj) {
					return null;
				}
				return new Response(obj.body, {
					headers: {
						'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
						'Content-Disposition': obj.httpMetadata?.contentDisposition || null,
						'Cache-Control': obj.httpMetadata?.cacheControl || null
					}
				});
			}

			if (storageType === 'S3') {
				return await s3Service.getObj(c, key);
			}

			return null;
		} catch (e) {
			const status = e?.$metadata?.httpStatusCode;
			const code = e?.name || e?.Code || e?.code;
			if (status === 404 || code === 'NoSuchKey' || code === 'NotFound') {
				return null;
			}
			throw e;
		}
	},

	async delete(c, key) {

		const storageType = await this.storageType(c);

		if (storageType === 'KV') {
			await kvObjService.deleteObj(c, key);
		}

		if (storageType === 'R2') {
			await c.env.r2.delete(key);
		}

		if (storageType === 'S3'){
			await s3Service.deleteObj(c, key);
		}

	}

};
export default r2Service;
