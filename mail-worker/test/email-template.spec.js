import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import emailHtmlTemplate from '../src/template/email-html';
import emailTextTemplate from '../src/template/email-text';

// 邮件正文嵌套在 JSON 字符串里交给沙箱 iframe，标记都被转义成 \u003C
function embeddedHtml(page) {
	const match = page.match(/srcdoc = (".*")/);
	return match ? JSON.parse(match[1]) : '';
}

describe('emailHtmlTemplate', () => {

	it('把正文放进不允许脚本、同源身份与表单提交的 sandbox iframe', () => {
		const page = emailHtmlTemplate('<p>hi</p>', 'oss.example.com');

		expect(page).toContain('<iframe id=\'mail-frame\' sandbox=\'allow-popups allow-popups-to-escape-sandbox\'>');
		expect(page).not.toMatch(/allow-scripts|allow-same-origin|allow-top-navigation|allow-forms/);
	});

	it('邮件标记只作为字符串数据传递，不会成为页面自身的标记', () => {
		const payload = '</script><img src=x onerror=alert(1)><script>alert(2)</script>';
		const page = emailHtmlTemplate(payload, 'oss.example.com');

		expect(page).not.toContain('<img');
		expect(page).not.toContain('<script>alert');
		expect(page).toContain('\\u003Cimg');
	});

	it('去掉会自行发起请求或跳转的标签', () => {
		const page = emailHtmlTemplate(`
			<script src="https://track.example/a.js"></script>
			<link rel="stylesheet" href="https://track.example/a.css">
			<meta http-equiv="refresh" content="0;url=https://track.example/">
			<base href="https://track.example/">
			<iframe src="https://track.example/frame"></iframe>
			<p>正文</p>`, 'oss.example.com');

		const html = embeddedHtml(page);
		expect(html).toContain('<p>正文</p>');
		expect(html).not.toMatch(/<script|<link|<meta|<base|<iframe/i);
	});

	it('去掉会伪装成凭证输入的表单类元素', () => {
		const html = embeddedHtml(emailHtmlTemplate(
			'<form action="https://evil.example/login"><input name="password"><button>登录</button></form>',
			'oss.example.com'));

		expect(html).not.toMatch(/<form|<input|<button/i);
	});

	it('去掉会自行加载的框架与模板标签', () => {
		const html = embeddedHtml(emailHtmlTemplate(
			'<frameset><frame src="https://track.example/frame"></frameset><applet code="x"></applet><template><img src="https://track.example/t.png"></template><p>ok</p>',
			'oss.example.com'));

		expect(html).toContain('<p>ok</p>');
		expect(html).not.toMatch(/<frameset|<frame|<applet|<template|<img/i);
	});

	it('链接统一改为另开窗口，邮件里的 target 被覆盖', () => {
		const html = embeddedHtml(emailHtmlTemplate(
			'<a href="https://evil.example/phish" target="_top">查看</a><map><area href="https://evil.example/x" target="_parent"></map>',
			'oss.example.com'));

		expect(html).not.toMatch(/target="_(?:top|parent|self)"/i);
		expect(html.match(/target="_blank"/g)).toHaveLength(2);
		expect(html.match(/rel="noopener noreferrer nofollow"/g)).toHaveLength(2);
	});

	it('生成的邮件文档带 doctype', () => {
		const full = embeddedHtml(emailHtmlTemplate('<!DOCTYPE html><html><body><p>x</p></body></html>', 'oss.example.com'));
		const fragment = embeddedHtml(emailHtmlTemplate('<p>x</p>', 'oss.example.com'));

		expect(full.trimStart().toLowerCase().startsWith('<!doctype html')).toBe(true);
		expect(fragment.trimStart().toLowerCase().startsWith('<!doctype html')).toBe(true);
	});

	it('保留邮件自带样式与 body 属性', () => {
		const html = embeddedHtml(emailHtmlTemplate(
			'<!DOCTYPE html><html><head><style>.a{color:red}</style></head><body style="background:#fff"><p>x</p></body></html>',
			'oss.example.com'));

		expect(html).toContain('.a{color:red}');
		expect(html).toContain('style="background:#fff"');
	});

	it('替换 {{domain}} 并把链接加固', () => {
		const html = embeddedHtml(emailHtmlTemplate(
			'<img src="{{domain}}att/a.png"><a href="https://x.example/">l</a>',
			'oss.example.com'));

		expect(html).toContain('https://oss.example.com/att/a.png');
		expect(html).toContain('rel="noopener noreferrer nofollow"');
	});

	it('body 属性里的注入只作为数据传递', () => {
		const page = emailHtmlTemplate(
			'<body style="}</style><img src=x onerror=alert(1)>"><p>ok</p></body>',
			'oss.example.com');

		expect(page).not.toContain('<img');
		expect(page).toContain('\\u003Cimg src=x');
	});
});

describe('emailTextTemplate', () => {
	it('转义纯文本正文', () => {
		const page = emailTextTemplate('<script>alert(1)</script> & "quoted"');

		expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; "quoted"');
		expect(page).not.toContain('<script>');
	});
});
