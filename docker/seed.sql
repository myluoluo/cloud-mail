UPDATE setting SET notice = 1, auto_refresh = 0, background = '', login_opacity = 1;
UPDATE account SET name = '小博' WHERE email = 'xiaobo@cloudmail.test';
INSERT INTO account (email, name, user_id) VALUES
  ('work@cloudmail.test', '工作往来', 1),
  ('newsletter@cloudmail.test', '阅读订阅', 1);
INSERT INTO email (send_email, name, account_id, user_id, subject, text, recipient, to_email, unread, create_time) VALUES
  ('lin@studio.test', '林知夏', 1, 1, '关于下周的设计交流', '小博，你好：

上次聊到的几个设计方向，我整理了一份简短的笔记。比起增加更多功能，我们可以先把最常用的阅读体验做好。

下周三下午三点方便吗？我们可以一起看一下新的收件箱、邮件阅读和移动端布局。

讨论重点：
1. 让信息层级更清晰，打开就能找到重要邮件。
2. 给正文留出舒适的阅读空间。
3. 保留熟悉的操作，让变化自然发生。

期待你的想法。

知夏', '[{"address":"xiaobo@cloudmail.test","name":"小博"}]', 'xiaobo@cloudmail.test', 0, datetime('now', '-12 minutes')),
  ('updates@github.test', 'GitHub', 1, 1, '[cloud-mail] 界面更新已准备就绪', '新的界面分支已经准备好，可以开始检查导航、收件箱和响应式布局。', '[{"address":"xiaobo@cloudmail.test"}]', 'xiaobo@cloudmail.test', 0, datetime('now', '-35 minutes')),
  ('hello@read.test', '少数派', 1, 1, '本周读物 · 给数字生活留一点空白', '一份关于工具、专注与日常的小小阅读清单。让工具退后，让内容走到前面。', '[{"address":"xiaobo@cloudmail.test"}]', 'xiaobo@cloudmail.test', 0, datetime('now', '-1 hour')),
  ('chen@studio.test', '陈亦舟', 1, 1, 'Re: 项目素材和排版参考', '已经把新版素材整理好了。关于中文排版，我倾向于更清晰的层级和更松弛的行间距。', '[{"address":"xiaobo@cloudmail.test"}]', 'xiaobo@cloudmail.test', 1, datetime('now', '-2 hours')),
  ('billing@cloud.test', 'Cloudflare', 1, 1, '你的月度用量报告', '本月 Workers 与 D1 用量报告已生成，请登录控制台查看详细数据。', '[{"address":"xiaobo@cloudmail.test"}]', 'xiaobo@cloudmail.test', 1, datetime('now', '-3 hours')),
  ('team@figma.test', 'Figma', 1, 1, '有人在设计文件中提到了你', '林知夏在「邮件工作台」中添加了一条评论：这一版的阅读区域看起来很舒服。', '[{"address":"xiaobo@cloudmail.test"}]', 'xiaobo@cloudmail.test', 1, datetime('now', '-4 hours')),
  ('hello@weekly.test', '独立开发周刊', 1, 1, '第 128 期：做一件小而完整的事', '这一期，我们聊聊个人项目的取舍，以及为什么好的工具应该安静地待在身边。', '[{"address":"xiaobo@cloudmail.test"}]', 'xiaobo@cloudmail.test', 1, datetime('now', '-6 hours')),
  ('no-reply@auth.test', 'Pocket ID', 1, 1, '新的账户登录通知', '你的账户刚刚完成了一次登录。如果这是你本人的操作，无需进一步处理。', '[{"address":"xiaobo@cloudmail.test"}]', 'xiaobo@cloudmail.test', 1, datetime('now', '-8 hours')),
  ('wang@studio.test', '王一然', 1, 1, '周五见，一起喝杯咖啡', '附近新开了一家咖啡店，听说很安静。周五下午一起去坐坐，顺便聊聊最近的项目。', '[{"address":"xiaobo@cloudmail.test"}]', 'xiaobo@cloudmail.test', 1, datetime('now', '-1 day')),
  ('team@project.test', '项目团队', 2, 1, '十月项目进度与待办', '本周工作已经整理完成，接下来重点检查邮件列表和账户切换。', '[{"address":"work@cloudmail.test"}]', 'work@cloudmail.test', 0, datetime('now', '-45 minutes')),
  ('editor@letter.test', '设计周刊', 3, 1, '把阅读的节奏交还给你', '不赶时间的阅读，从一封信开始。', '[{"address":"newsletter@cloudmail.test"}]', 'newsletter@cloudmail.test', 1, datetime('now', '-3 hours'));
INSERT INTO star (user_id, email_id) VALUES (1, 1), (1, 4);
