import { parseHTML } from 'linkedom';
import domainUtils from '../utils/domain-uitls';

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
const UNWANTED_SELECTOR = 'script, link, meta, base, iframe, frame, frameset, object, embed, applet, template, form, input, button, select, option, textarea, label, fieldset, legend';

const LINK_REL = 'noopener noreferrer nofollow';

// linkedom 只在输入自带文档骨架时才给出规范的 head/body，其余需要补齐再解析
const DOCUMENT_ROOTS = ['html', 'head', 'body'];

function parseMailDocument(html) {

	const { document } = parseHTML(html);

	if (DOCUMENT_ROOTS.includes(document.documentElement?.localName)) return document;

	return parseHTML(`<html><head></head><body>${html}</body></html>`).document;
}

function prepareDocument(html) {

	const document = parseMailDocument(html);

	document.querySelectorAll(UNWANTED_SELECTOR).forEach(node => node.remove());
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
	return page.trimStart().toLowerCase().startsWith('<!doctype') ? page : `<!DOCTYPE html>\n${page}`;
}

export default function emailHtmlTemplate(html, domain) {

	const page = prepareDocument(html).replace(/{{domain}}/g, domainUtils.toOssDomain(domain) + '/');
	const safeHtmlJson = JSON.stringify(page).replace(/</g, '\\u003C');

	return `<!DOCTYPE html>
<html lang='en' >
<head>
    <meta charset='UTF-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1.0'>
    <style>
        html, body {
            margin: 0;
            padding: 0;
            height: 100%;
            background: #FFF;
        }

        #mail-frame {
            display: block;
            width: 100%;
            height: 100%;
            border: 0;
            background: #FFF;
        }
    </style>
</head>
<body>
    <iframe id='mail-frame' sandbox='${SANDBOX}'></iframe>

    <script>
        document.getElementById('mail-frame').srcdoc = ${safeHtmlJson};
    </script>
</body>
</html>`
}
