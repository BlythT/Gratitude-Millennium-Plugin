import { Millennium, IconsModule, definePlugin, Field, DialogButton, callable } from '@steambrew/client';

class classname {
	static method(country: string, age: number) {
		console.log(`age: ${age}, country: ${country}`);
		return 'method called';
	}
}

// export classname class to global context
Millennium.exposeObj({ classname });

function windowCreated(context: any) {
	// window create event.
	// you can interact directly with the document and monitor it with dom observers
	// you can then render components in specific pages.
	console.log(context);
}

// Declare a function that exists on the backend
const backendMethod = callable<[{ message: string; status: boolean; count: number }], boolean>('test_frontend_message_callback');

const SettingsContent = () => {
	return (
		<Field label="Plugin Settings" description="This is a description of the plugin settings." icon={<IconsModule.Settings />} bottomSeparator="standard" focusable>
			<DialogButton
				onClick={() => {
					console.log('Button clicked!');
				}}
			>
				Click Me
			</DialogButton>
		</Field>
	);
};

export default definePlugin(() => {
	// Call the backend method
	backendMethod({
		message: 'Hello World From Frontend!',
		status: true,
		count: 69,
	}).then((message: any) => {
		console.log('Result from backendMethod:', message);
	});

	Millennium.AddWindowCreateHook(windowCreated);

	return {
		title: 'My Plugin',
		icon: <IconsModule.Settings />,
		content: <SettingsContent />,
	};
});
