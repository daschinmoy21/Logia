import { Sparkles } from 'lucide-react';

function Toolbar() {


  return (
    <div className="h-10 py-1 w-full bg-zinc-900 border-b border-zinc-800 flex items-end justify-end px-4">
      <div className="flex items-end space-x-2">
        <button className='border border-zinc-800 text-white hover:bg-zinc-600'>
          <Sparkles size={19} />
        </button>
      </div>
    </div>
  );
}


export default Toolbar;
