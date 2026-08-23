import { useEffect, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { Card } from '../components/Field.tsx';

export function ShortcutsTab() {
  const [commands, setCommands] = useState<chrome.commands.Command[]>([]);

  useEffect(() => {
    chrome.commands.getAll()
      .then((list) => setCommands(list.filter((c) => c.description)))
      .catch(() => setCommands([]));
  }, []);

  return (
    <Card title="快捷键">
      <div className="flex flex-col gap-2">
        {commands.map((cmd) => (
          <div key={cmd.name} className="flex justify-between items-center px-3 py-2.5 bg-base-200 rounded-lg">
            <span className="text-sm text-base-content/70">{cmd.description}</span>
            <span className="font-mono text-xs px-2.5 py-1 bg-base-100 border border-base-300 rounded">
              {cmd.shortcut || '未设置'}
            </span>
          </div>
        ))}
        {commands.length === 0 && (
          <p className="text-sm text-base-content/50">读取不到快捷键配置</p>
        )}
      </div>

      <button
        className="btn btn-outline btn-sm gap-1 self-start"
        onClick={() => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}
      >
        <Keyboard className="w-4 h-4" />
        修改快捷键
      </button>
      <p className="text-xs text-base-content/40">
        Chrome 不允许扩展自己改快捷键，需要在浏览器的扩展快捷键页面里设置。
      </p>
    </Card>
  );
}
