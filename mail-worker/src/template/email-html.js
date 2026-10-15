import { parseHTML } from 'linkedom';
import domainUtils from '../utils/domain-uitls';
import * as cssTree from 'css-tree';
import parseSrcset from 'parse-srcset';
import { rewriteEmailResources } from '../../../shared/email-resources.js';

// 正文放进完全隔离的 iframe：不给同源身份，也不允许执行脚本与提交表单，
// 即便邮件里有活动内容也无法触及页面与接口；链接统一走 allow-popups 另开窗口。
const SANDBOX = 'allow-popups allow-popups-to-escape-sandbox';

// 邮件文档的基础排版，与前端 ShadowHtml 的外壳保持一致
const SHELL_STYLE = `
        html {
            background: #FFFFFF;
        }

        body {
            margin: 0;
            min-width: 100%;
            font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            font-size: 14px;
            line-height: 1.5;
            color: #13181D;
            word-break: break-word;
        }

        h1, h2, h3, h4 {
            font-size: 18px;
            font-weight: 700;
        }

        p {
            margin: 0;
        }

        a {
            text-decoration: none;
            color: #0E70DF;
        }

        img:not(table img) {
            max-width: 100% !important;
            height: auto !important;
        }
`;

// 脚本与表单提交由沙箱拦下，这里再去掉会自行发起请求、跳转或伪装凭证输入的标签
const UNWANTED_SELECTOR = 'script, link, meta, base, iframe, frame, frameset, object, embed, applet, template, noscript, form, input, button, select, option, textarea, label, fieldset, legend, svg, math';

const LINK_REL = 'noopener noreferrer nofollow';

// linkedom 只在输入自带文档骨架时才给出规范的 head/body，其余需要补齐再解析
const DOCUMENT_ROOTS = ['html', 'head', 'body'];

export function parseMailDocument(html) {

	const { document } = parseHTML(html);

	if (DOCUMENT_ROOTS.includes(document.documentElement?.localName)) return document;

	return parseHTML(`<html><head></head><body>${html}</body></html>`).document;
}

function prepareDocument(html, options) {

	const document = parseMailDocument(html);

	document.querySelectorAll(UNWANTED_SELECTOR).forEach(node => node.remove());
	const blockedRemoteCount = rewriteEmailResources(document, options, {cssTree, parseSrcset});
	// 统一另开窗口，邮件里的 target 不能把查看页或 iframe 导航走
	document.querySelectorAll('a[href], area[href]').forEach(link => {
		link.setAttribute('target', '_blank');
		link.setAttribute('rel', LINK_REL);
	});

	const style = document.createElement('style');
	style.textContent = SHELL_STYLE;
	document.head.insertBefore(style, document.head.firstChild);

	const page = document.toString();

	// 片段式邮件没有 doctype，补一个以免 iframe 落入怪异模式
	return {html: page.trimStart().toLowerCase().startsWith('<!doctype') ? page : `<!DOCTYPE html>\n${page}`, blockedRemoteCount};
}

export default function emailHtmlTemplate(html, domain, options = {}) {

	const ossDomain = domainUtils.toOssDomain(domain);
	const page = prepareDocument(html.replace(/{{domain}}/g, (ossDomain || '') + '/'), {
		baseUrl: options.baseUrl || 'https://mail.invalid/', allowedOrigins: ossDomain ? [ossDomain] : [],
	});
	const safeHtmlJson = JSON.stringify(page.html).replace(/</g, '\\u003C');
	const remoteBar = page.blockedRemoteCount > 0 ? `<div id="remote-bar">为保护隐私，已屏蔽邮件中的远程内容。<button id="show-remote">显示远程内容</button></div>` : '';

	return `<!DOCTYPE html>
<html lang='en' >
<head>
    <meta charset='UTF-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1.0'>
    <meta name='referrer' content='no-referrer'>
    <style>
        html, body {
            margin: 0;
            padding: 0;
            height: 100%;
            background: #FFF;
        }
        body { display: flex; flex-direction: column; }
        #remote-bar { padding: 8px 12px; font: 12px sans-serif; background: #f5f7fa; }
        #show-remote { margin-left: 8px; cursor: pointer; }

        #mail-frame {
            display: block;
            width: 100%;
            height: 100%;
            border: 0;
            background: #FFF;
            flex: 1;
            min-height: 0;
        }
    </style>
</head>
<body>
    ${remoteBar}
    <iframe id='mail-frame' sandbox='${SANDBOX}' referrerpolicy='no-referrer'></iframe>

    <script>
        document.getElementById('mail-frame').srcdoc = ${safeHtmlJson};
        document.getElementById('show-remote')?.addEventListener('click', () => {
            const url = new URL(window.location.href);
            url.searchParams.set('remote', '1');
            window.location.replace(url.href);
        });
    </script>
</body>
</html>`
}
